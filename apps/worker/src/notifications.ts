import { type PushPayload, PushPayloadSchema, type NotificationKind } from "@triatlo/shared";
import { utcToLocalDate } from "@triatlo/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushSender } from "./push";

/** Policy constants for delivery (documented in docs/BUSINESS_RULES.md; not physiological). */
export const MAX_NOTIFICATIONS_PER_DAY = 4;
export const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = [5, 30];

export interface EnqueueInput { userId: string; kind: NotificationKind; runAt: string; payload: PushPayload; idempotencyKey: string; sourceRef?: string | null }

/** Idempotent: the same key never creates a second notification. Payloads carry NO health data. */
export async function enqueueNotification(db: SupabaseClient, n: EnqueueInput): Promise<boolean> {
  const payload = PushPayloadSchema.parse(n.payload);
  const { data, error } = await db.from("scheduled_notifications").upsert(
    { user_id: n.userId, kind: n.kind, run_at: n.runAt, payload, idempotency_key: n.idempotencyKey, source_ref: n.sourceRef ?? null },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  ).select("id");
  if (error) throw new Error(`enqueue notification: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Minutes-since-midnight in `timeZone` for an instant. */
function localMinutes(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** If `now` falls inside the quiet hours (local), returns minutes until they end; otherwise 0. Handles overnight ranges. */
export function minutesUntilQuietEnds(nowIso: string, timeZone: string, start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const now = localMinutes(nowIso, timeZone), s = toMin(start), e = toMin(end);
  const inside = s <= e ? now >= s && now < e : now >= s || now < e;
  if (!inside) return 0;
  return (e - now + 1440) % 1440 || 1440;
}

export type DispatchSummary = { sent: number; deferred: number; cancelled: number; failed: number; retried: number };

/** Delivers due notifications. Respects: user opt-in, quiet hours, daily cap, validated payloads, dead-subscription cleanup. */
export async function dispatchDueNotifications(db: SupabaseClient, nowIso: string, sender: PushSender, limit = 25): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, deferred: 0, cancelled: 0, failed: 0, retried: 0 };
  const due = await db.from("scheduled_notifications").select("*").eq("status", "pending").lte("run_at", nowIso).order("run_at").limit(limit);
  if (due.error) throw new Error(`load due notifications: ${due.error.message}`);
  for (const n of (due.data ?? []) as Array<{ id: string; user_id: string; payload: unknown; attempts: number }>) {
    // atomic claim: only one worker proceeds
    const claim = await db.from("scheduled_notifications").update({ status: "claimed", attempts: n.attempts + 1 }).eq("id", n.id).eq("status", "pending").select("id");
    if ((claim.data ?? []).length === 0) continue;

    const finish = (patch: Record<string, unknown>) => db.from("scheduled_notifications").update(patch).eq("id", n.id);
    const prefs = (await db.from("user_preferences").select("notifications_enabled, quiet_hours_start, quiet_hours_end").eq("user_id", n.user_id).maybeSingle()).data as { notifications_enabled: boolean; quiet_hours_start: string | null; quiet_hours_end: string | null } | null;
    if (!prefs?.notifications_enabled) { await finish({ status: "cancelled", last_error: "notifications_disabled" }); summary.cancelled++; continue; }
    const tz = ((await db.from("profiles").select("timezone").eq("user_id", n.user_id).maybeSingle()).data as { timezone: string | null } | null)?.timezone ?? null;
    if (tz) {
      const wait = minutesUntilQuietEnds(nowIso, tz, prefs.quiet_hours_start, prefs.quiet_hours_end);
      if (wait > 0) { await finish({ status: "pending", attempts: n.attempts, run_at: new Date(Date.parse(nowIso) + wait * 60_000).toISOString() }); summary.deferred++; continue; }
    }
    const dayAgo = new Date(Date.parse(nowIso) - 86_400_000).toISOString();
    const sentToday = await db.from("scheduled_notifications").select("id", { count: "exact", head: true }).eq("user_id", n.user_id).eq("status", "sent").gte("sent_at", dayAgo);
    if ((sentToday.count ?? 0) >= MAX_NOTIFICATIONS_PER_DAY) { await finish({ status: "cancelled", last_error: "daily_cap" }); summary.cancelled++; continue; }

    const parsed = PushPayloadSchema.safeParse(n.payload);
    if (!parsed.success) { await finish({ status: "failed", last_error: "invalid_payload" }); summary.failed++; continue; }
    const subs = ((await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id).eq("active", true)).data ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
    if (subs.length === 0) { await finish({ status: "cancelled", last_error: "no_active_subscription" }); summary.cancelled++; continue; }

    let delivered = 0, transient = false;
    for (const s of subs) {
      const r = await sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(parsed.data));
      if (r.ok) { delivered++; await db.from("push_subscriptions").update({ last_success_at: nowIso, last_error: null }).eq("id", s.id); }
      else if (r.statusCode === 404 || r.statusCode === 410) await db.from("push_subscriptions").update({ active: false, last_error_at: nowIso, last_error: `gone (${r.statusCode})` }).eq("id", s.id);
      else { transient = true; await db.from("push_subscriptions").update({ last_error_at: nowIso, last_error: `status ${r.statusCode ?? "network"}` }).eq("id", s.id); }
    }
    if (delivered > 0) { await finish({ status: "sent", sent_at: nowIso, last_error: null }); summary.sent++; }
    else if (transient && n.attempts + 1 < MAX_ATTEMPTS) {
      await finish({ status: "pending", run_at: new Date(Date.parse(nowIso) + (RETRY_MINUTES[n.attempts] ?? 30) * 60_000).toISOString(), last_error: "transient_delivery_error" }); summary.retried++;
    } else { await finish({ status: "failed", last_error: transient ? "delivery_failed" : "subscriptions_gone" }); summary.failed++; }
  }
  return summary;
}

export { utcToLocalDate };

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDate, utcToLocalDate } from "@triatlo/domain";
import { enqueueNotification } from "./notifications";

/** Local hour (0-23) of an instant. */
function localHour(iso: string, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).find((p) => p.type === "hour")?.value);
}
const rows = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
};

/** Earliest local hour at which the daily evaluation may run (after the night's sleep data had a chance to arrive). */
export const ADAPT_FROM_LOCAL_HOUR = 6;
export const MORNING_CHECKIN_FROM_HOUR = 9;
export const MORNING_CHECKIN_UNTIL_HOUR = 12;
export const WORKOUT_REMINDER_LEAD_MINUTES = 60;

/** One `adapt.daily` job per user per LOCAL day, only for users with an approved rule set. Idempotent by key. */
export async function scheduleDailyAdaptation(db: SupabaseClient, nowIso: string): Promise<number> {
  const approved = rows<{ user_id: string }>(await db.from("training_rule_sets").select("user_id").eq("status", "approved"), "load approved rule sets");
  const users = [...new Set(approved.map((r) => r.user_id))];
  if (users.length === 0) return 0;
  const profiles = rows<{ user_id: string; timezone: string | null }>(await db.from("profiles").select("user_id, timezone").in("user_id", users), "load profiles");
  let created = 0;
  for (const p of profiles) {
    if (!p.timezone || localHour(nowIso, p.timezone) < ADAPT_FROM_LOCAL_HOUR) continue;   // never assume a timezone; wait for the morning
    const date = utcToLocalDate(nowIso, p.timezone);
    const res = await db.rpc("enqueue_background_job", { p_type: "adapt.daily", p_user_id: p.user_id, p_run_at: nowIso, p_idempotency_key: `adapt.daily:${p.user_id}:${date}`, p_source_ref: `day:${date}`, p_payload: {}, p_max_attempts: 3 });
    if (res.error) throw new Error(`enqueue adapt.daily: ${res.error.message}`);
    if (res.data) created++;
  }
  return created;
}

/** A gentle morning check-in reminder, only if the user opted in and has not answered yet that local day. */
export async function scheduleMorningCheckins(db: SupabaseClient, nowIso: string): Promise<number> {
  const prefs = rows<{ user_id: string }>(await db.from("user_preferences").select("user_id").eq("notifications_enabled", true), "load preferences");
  if (prefs.length === 0) return 0;
  const ids = prefs.map((p) => p.user_id);
  const profiles = rows<{ user_id: string; timezone: string | null }>(await db.from("profiles").select("user_id, timezone").in("user_id", ids), "load profiles");
  let created = 0;
  for (const p of profiles) {
    if (!p.timezone) continue;
    const hour = localHour(nowIso, p.timezone);
    if (hour < MORNING_CHECKIN_FROM_HOUR || hour >= MORNING_CHECKIN_UNTIL_HOUR) continue;
    const date = utcToLocalDate(nowIso, p.timezone);
    const done = rows<{ id: string }>(await db.from("daily_checkins").select("id").eq("user_id", p.user_id).eq("checkin_date", date), "load check-in");
    if (done.length > 0) continue;
    if (await enqueueNotification(db, { userId: p.user_id, kind: "morning_checkin", runAt: nowIso, idempotencyKey: `morning_checkin:${p.user_id}:${date}`, payload: { kind: "morning_checkin", title: "Bom dia", body: "Como você acordou hoje? Um check-in rápido ajuda a ajustar o dia.", url: "/", tag: "morning_checkin" } })) created++;
  }
  return created;
}

const MODALITY_PT: Record<string, string> = { swim: "natação", bike_indoor: "ciclismo indoor", run: "corrida", strength: "musculação", recovery: "recuperação", rest: "descanso" };

/** Reminder shortly before a planned session starts. A rescheduled session gets a new key (new start time). */
export async function scheduleWorkoutReminders(db: SupabaseClient, nowIso: string): Promise<number> {
  const until = new Date(Date.parse(nowIso) + WORKOUT_REMINDER_LEAD_MINUTES * 60_000).toISOString();
  const sessions = rows<{ user_id: string; session_id: string; modality: string; starts_at: string; status: string }>(
    await db.from("v_current_planned_workouts").select("user_id, session_id, modality, starts_at, status").eq("status", "planned").gt("starts_at", nowIso).lte("starts_at", until), "load upcoming sessions");
  if (sessions.length === 0) return 0;
  const enabled = new Set(rows<{ user_id: string }>(await db.from("user_preferences").select("user_id").eq("notifications_enabled", true).in("user_id", [...new Set(sessions.map((s) => s.user_id))]), "load preferences").map((r) => r.user_id));
  let created = 0;
  for (const s of sessions.filter((x) => enabled.has(x.user_id) && !["rest", "recovery"].includes(x.modality))) {
    const at = new Date(s.starts_at).toISOString();
    if (await enqueueNotification(db, { userId: s.user_id, kind: "workout_reminder", runAt: nowIso, idempotencyKey: `workout_reminder:${s.session_id}:${at}`, sourceRef: `session:${s.session_id}`, payload: { kind: "workout_reminder", title: "Treino em breve", body: `Sua sessão de ${MODALITY_PT[s.modality] ?? "treino"} começa em breve.`, url: "/workouts", tag: `workout:${s.session_id}` } })) created++;
  }
  return created;
}

export { addDaysToDate };

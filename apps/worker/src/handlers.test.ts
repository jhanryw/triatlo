import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DailyCheckinInputSchema } from "@triatlo/shared";
import { applyUserChanges, approveRuleSet, ensureActivePlan, ensureRuleSet, listProposals, saveCheckin, saveProfile } from "@triatlo/data";
import { createHarness } from "@triatlo/data/testing";
import { dispatchDueNotifications, enqueueNotification, minutesUntilQuietEnds, MAX_NOTIFICATIONS_PER_DAY } from "./notifications";
import { processJobs } from "./jobs";
import { scheduleDailyAdaptation, scheduleMorningCheckins, scheduleWorkoutReminders } from "./schedule";
import type { PushSender, PushTarget } from "./push";

const h = createHarness();
beforeAll(() => h.start());
afterAll(() => h.stop());

const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(NOW));
const d = (n: number) => { const [y, m, dd] = localToday.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const inHours = (hrs: number) => new Date(Date.parse(NOW) + hrs * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const payload = (kind: "approval_request" | "morning_checkin" | "workout_reminder" | "plan_change" = "approval_request") => ({ kind, title: "Triatlo", body: "Mensagem de teste", url: "/", tag: kind });

class FakeSender implements PushSender {
  sent: Array<{ target: PushTarget; payload: string }> = [];
  constructor(private respond: (t: PushTarget) => { ok: boolean; statusCode: number | null } = () => ({ ok: true, statusCode: 201 })) {}
  async send(target: PushTarget, body: string) { this.sent.push({ target, payload: body }); return this.respond(target); }
}

async function userWithPush(email: string, opts: { notifications?: boolean; quiet?: [string, string] | null } = {}) {
  const id = h.newUser(email);
  const ctx = h.userCtx(id);
  await saveProfile(ctx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
  await ctx.db.from("user_preferences").upsert({ user_id: id, notifications_enabled: opts.notifications ?? true, quiet_hours_start: opts.quiet?.[0] ?? null, quiet_hours_end: opts.quiet?.[1] ?? null }, { onConflict: "user_id" });
  const endpoint = `https://push.example.invalid/${randomUUID()}`;
  const sub = await ctx.db.from("push_subscriptions").insert({ user_id: id, endpoint, p256dh: "p256dh-key", auth: "auth-key", consent_text_version: "v1" }).select("id");
  expect(sub.error).toBeNull();
  return { id, ctx, endpoint };
}
const statusOf = async (key: string) => (await h.serviceClient().from("scheduled_notifications").select("status, attempts, last_error").eq("idempotency_key", key).single()).data as { status: string; attempts: number; last_error: string | null };

describe("quiet hours", () => {
  const SP = "America/Sao_Paulo"; // UTC-3
  it("handles overnight ranges (22:00-07:00) in the user's timezone", () => {
    expect(minutesUntilQuietEnds("2026-11-02T01:00:00Z", SP, "22:00", "07:00")).toBe(540);   // 22:00 local -> 07:00 = 9 h
    expect(minutesUntilQuietEnds("2026-11-02T07:00:00Z", SP, "22:00", "07:00")).toBe(180);   // 04:00 local
    expect(minutesUntilQuietEnds("2026-11-02T12:00:00Z", SP, "22:00", "07:00")).toBe(0);     // 09:00 local: not quiet
  });
  it("handles same-day ranges and an unset range", () => {
    expect(minutesUntilQuietEnds("2026-11-02T17:00:00Z", SP, "13:00", "15:00")).toBe(60);    // 14:00 local
    expect(minutesUntilQuietEnds("2026-11-02T19:00:00Z", SP, "13:00", "15:00")).toBe(0);     // 16:00 local
    expect(minutesUntilQuietEnds("2026-11-02T17:00:00Z", SP, null, null)).toBe(0);
  });
});

describe.skipIf(!h.enabled)("notification delivery against a real database", () => {
  it("sends once, idempotently, with the validated payload; the subscription records success", async () => {
    const u = await userWithPush("push-ok@wk.invalid");
    const db = h.serviceClient();
    expect(await enqueueNotification(db, { userId: u.id, kind: "approval_request", runAt: NOW, payload: payload(), idempotencyKey: `t-ok:${u.id}` })).toBe(true);
    expect(await enqueueNotification(db, { userId: u.id, kind: "approval_request", runAt: NOW, payload: payload(), idempotencyKey: `t-ok:${u.id}` })).toBe(false);   // duplicate key = no-op
    const sender = new FakeSender();
    const r1 = await dispatchDueNotifications(db, inHours(0.01), sender);
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const mine = sender.sent.filter((s) => s.target.endpoint === u.endpoint);
    expect(mine).toHaveLength(1);
    expect(JSON.parse(mine[0]!.payload)).toMatchObject({ kind: "approval_request", url: "/" });
    expect(await statusOf(`t-ok:${u.id}`)).toMatchObject({ status: "sent", attempts: 1 });
    await dispatchDueNotifications(db, inHours(0.02), sender);
    expect(sender.sent.filter((s) => s.target.endpoint === u.endpoint)).toHaveLength(1);        // never re-sent
    const sub = await db.from("push_subscriptions").select("last_success_at").eq("user_id", u.id).single();
    expect(sub.data?.last_success_at).not.toBeNull();
  });

  it("a user session can neither read subscription keys nor mark a notification as sent", async () => {
    const u = await userWithPush("push-sec@wk.invalid");
    expect((await u.ctx.db.from("push_subscriptions").select("p256dh, auth")).error).not.toBeNull();
    await enqueueNotification(u.ctx.db, { userId: u.id, kind: "morning_checkin", runAt: inHours(5), payload: payload("morning_checkin"), idempotencyKey: `t-sec:${u.id}` });
    const forged = await u.ctx.db.from("scheduled_notifications").update({ status: "sent" }).eq("idempotency_key", `t-sec:${u.id}`);
    expect(forged.error).not.toBeNull();
  });

  it("respects opt-out, quiet hours (deferred, not dropped), the daily cap and invalid payloads", async () => {
    const db = h.serviceClient();
    const off = await userWithPush("push-off@wk.invalid", { notifications: false });
    await enqueueNotification(db, { userId: off.id, kind: "approval_request", runAt: NOW, payload: payload(), idempotencyKey: `t-off:${off.id}` });
    await dispatchDueNotifications(db, inHours(0.01), new FakeSender());
    expect(await statusOf(`t-off:${off.id}`)).toMatchObject({ status: "cancelled", last_error: "notifications_disabled" });

    // quiet hours covering "now" in Sao Paulo: a window of +-1h around the current local time
    const localNow = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(inHours(0.01)));
    const hour = Number(localNow.slice(0, 2));
    const pad = (n: number) => String(((n % 24) + 24) % 24).padStart(2, "0");
    const quiet = await userWithPush("push-quiet@wk.invalid", { quiet: [`${pad(hour - 1)}:00`, `${pad(hour + 1)}:00`] });
    await enqueueNotification(db, { userId: quiet.id, kind: "approval_request", runAt: NOW, payload: payload(), idempotencyKey: `t-quiet:${quiet.id}` });
    const sender = new FakeSender();
    const r = await dispatchDueNotifications(db, inHours(0.01), sender);
    expect(r.deferred).toBeGreaterThanOrEqual(1);
    expect(sender.sent.filter((s) => s.target.endpoint === quiet.endpoint)).toHaveLength(0);
    const deferred = await db.from("scheduled_notifications").select("status, run_at, attempts").eq("idempotency_key", `t-quiet:${quiet.id}`).single();
    expect(deferred.data).toMatchObject({ status: "pending", attempts: 0 });
    expect(Date.parse(deferred.data!.run_at)).toBeGreaterThan(Date.parse(NOW));

    const capped = await userWithPush("push-cap@wk.invalid");
    for (let i = 0; i < MAX_NOTIFICATIONS_PER_DAY + 1; i++) await enqueueNotification(db, { userId: capped.id, kind: "approval_request", runAt: inHours(0.001 * (i + 1)), payload: payload(), idempotencyKey: `t-cap:${capped.id}:${i}` });
    const capSender = new FakeSender();
    for (let i = 0; i < MAX_NOTIFICATIONS_PER_DAY + 1; i++) await dispatchDueNotifications(db, inHours(0.2 + i * 0.01), capSender);
    expect(capSender.sent.filter((s) => s.target.endpoint === capped.endpoint)).toHaveLength(MAX_NOTIFICATIONS_PER_DAY);
    expect((await statusOf(`t-cap:${capped.id}:${MAX_NOTIFICATIONS_PER_DAY}`)).last_error).toBe("daily_cap");

    const bad = await userWithPush("push-bad@wk.invalid");
    await db.from("scheduled_notifications").insert({ user_id: bad.id, kind: "approval_request", run_at: NOW, payload: { title: "x" }, idempotency_key: `t-bad:${bad.id}` });
    await dispatchDueNotifications(db, inHours(0.3), new FakeSender());
    expect(await statusOf(`t-bad:${bad.id}`)).toMatchObject({ status: "failed", last_error: "invalid_payload" });
  });

  it("deactivates subscriptions the push service reports gone (410) and retries transient errors, then gives up", async () => {
    const db = h.serviceClient();
    const gone = await userWithPush("push-gone@wk.invalid");
    await enqueueNotification(db, { userId: gone.id, kind: "approval_request", runAt: NOW, payload: payload(), idempotencyKey: `t-gone:${gone.id}` });
    await dispatchDueNotifications(db, inHours(0.5), new FakeSender(() => ({ ok: false, statusCode: 410 })));
    expect(await statusOf(`t-gone:${gone.id}`)).toMatchObject({ status: "failed", last_error: "subscriptions_gone" });
    expect((await db.from("push_subscriptions").select("active").eq("user_id", gone.id).single()).data?.active).toBe(false);

    const flaky = await userWithPush("push-flaky@wk.invalid");
    await enqueueNotification(db, { userId: flaky.id, kind: "approval_request", runAt: NOW, payload: payload(), idempotencyKey: `t-flaky:${flaky.id}` });
    const failing = new FakeSender(() => ({ ok: false, statusCode: 503 }));
    await dispatchDueNotifications(db, inHours(0.6), failing);
    expect(await statusOf(`t-flaky:${flaky.id}`)).toMatchObject({ status: "pending", attempts: 1 });
    await dispatchDueNotifications(db, inHours(2), failing);
    expect(await statusOf(`t-flaky:${flaky.id}`)).toMatchObject({ status: "pending", attempts: 2 });
    await dispatchDueNotifications(db, inHours(6), failing);
    expect(await statusOf(`t-flaky:${flaky.id}`)).toMatchObject({ status: "failed", attempts: 3, last_error: "delivery_failed" });
    const ok = new FakeSender();
    await dispatchDueNotifications(db, inHours(7), ok);
    expect(ok.sent.filter((s) => s.target.endpoint === flaky.endpoint)).toHaveLength(0);     // failed ones are not retried forever
  });
});

describe.skipIf(!h.enabled)("scheduling and job processing against a real database", () => {
  async function worseningUser(email: string, autoApply: boolean) {
    const id = h.newUser(email);
    const ctx = h.userCtx(id);
    await saveProfile(ctx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
    for (let n = -12; n <= -2; n++) await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: d(n), fatigueScore: 2, energyScore: 4 }));
    for (const n of [-1, 0]) await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: d(n), fatigueScore: 4, energyScore: 2 }));
    await applyUserChanges(ctx, [{ type: "add_session", session: { id: randomUUID(), modality: "run", objective: null, startsAt: inHours(6), durationMinutes: 60, intensity: null, targets: [], instructions: null, status: "planned" } }], "Plano");
    await approveRuleSet(ctx, (await ensureRuleSet(ctx)).id, { enableAutoApply: autoApply });
    await ctx.db.from("user_preferences").upsert({ user_id: id, notifications_enabled: true }, { onConflict: "user_id" });
    return { id, ctx };
  }

  it("enqueues ONE adapt.daily job per user per local day, processes it, applies the approved auto change and notifies", async () => {
    const u = await worseningUser("sched-auto@wk.invalid", true);
    const db = h.serviceClient();
    // the scheduler only acts from the local morning; run it at a time that is >= 06:00 local today
    const morning = new Date(`${localToday}T12:00:00Z`).toISOString();   // 09:00 in Sao Paulo
    const created = await scheduleDailyAdaptation(db, morning);
    expect(created).toBeGreaterThanOrEqual(1);
    expect(await scheduleDailyAdaptation(db, morning)).toBe(0);            // same local day: idempotent
    const before = await ensureActivePlan(u.ctx);
    const summary = await processJobs(db, "wk-test", NOW, 50);
    expect(summary.failed).toBe(0);
    const mine = await db.from("background_jobs").select("status, attempts, type").eq("user_id", u.id).single();
    expect(mine.data).toMatchObject({ status: "succeeded", type: "adapt.daily" });
    const after = await ensureActivePlan(u.ctx);
    expect(after.version).toBe(before.version + 1);
    expect(after.sessions[0]?.durationMinutes).toBe(48);
    const n = await db.from("scheduled_notifications").select("kind, payload").eq("user_id", u.id);
    expect((n.data ?? []).map((x: { kind: string }) => x.kind)).toEqual(["plan_change"]);
    expect(JSON.stringify(n.data)).not.toMatch(/fadiga|sono|cansa|\d+ ?min/i);                    // no health data in the push text
  });

  it("without the auto-apply opt-in it only proposes and asks for approval", async () => {
    const u = await worseningUser("sched-prop@wk.invalid", false);
    const db = h.serviceClient();
    await scheduleDailyAdaptation(db, new Date(`${localToday}T12:00:00Z`).toISOString());
    const before = await ensureActivePlan(u.ctx);
    await processJobs(db, "wk-test", NOW, 50);
    expect((await ensureActivePlan(u.ctx)).version).toBe(before.version);
    expect(await listProposals(u.ctx)).toHaveLength(1);
    const n = await db.from("scheduled_notifications").select("kind").eq("user_id", u.id);
    expect((n.data ?? []).map((x: { kind: string }) => x.kind)).toEqual(["approval_request"]);
  });

  it("does not schedule before the local morning and never assumes a timezone", async () => {
    const u = await worseningUser("sched-early@wk.invalid", true);
    const db = h.serviceClient();
    const before = await db.from("background_jobs").select("id", { count: "exact", head: true }).eq("user_id", u.id);
    await scheduleDailyAdaptation(db, new Date(`${localToday}T06:00:00Z`).toISOString());   // 03:00 in Sao Paulo
    const after = await db.from("background_jobs").select("id", { count: "exact", head: true }).eq("user_id", u.id);
    expect(after.count).toBe(before.count);
    const noTz = h.newUser("sched-notz@wk.invalid");
    await h.userCtx(noTz).db.from("user_preferences").upsert({ user_id: noTz, notifications_enabled: true }, { onConflict: "user_id" });
    expect(await scheduleMorningCheckins(db, NOW)).toBeGreaterThanOrEqual(0);
    expect((await db.from("scheduled_notifications").select("id").eq("user_id", noTz)).data).toHaveLength(0);
  });

  it("morning check-in reminder only when none exists; workout reminder once per start time", async () => {
    const id = h.newUser("sched-remind@wk.invalid");
    const ctx = h.userCtx(id);
    await saveProfile(ctx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
    await ctx.db.from("user_preferences").upsert({ user_id: id, notifications_enabled: true }, { onConflict: "user_id" });
    const db = h.serviceClient();
    const nineLocal = new Date(`${localToday}T12:00:00Z`).toISOString();
    await scheduleMorningCheckins(db, nineLocal);
    await scheduleMorningCheckins(db, nineLocal);
    expect((await db.from("scheduled_notifications").select("kind").eq("user_id", id).eq("kind", "morning_checkin")).data).toHaveLength(1);
    await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: d(1), moodScore: 3 }));
    const answeredUser = h.newUser("sched-answered@wk.invalid");
    const actx = h.userCtx(answeredUser);
    await saveProfile(actx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
    await actx.db.from("user_preferences").upsert({ user_id: answeredUser, notifications_enabled: true }, { onConflict: "user_id" });
    await saveCheckin(actx, DailyCheckinInputSchema.parse({ checkinDate: localToday, moodScore: 3 }));
    await scheduleMorningCheckins(db, nineLocal);
    expect((await db.from("scheduled_notifications").select("id").eq("user_id", answeredUser)).data).toHaveLength(0);

    await applyUserChanges(ctx, [{ type: "add_session", session: { id: randomUUID(), modality: "swim", objective: null, startsAt: inHours(0.5), durationMinutes: 40, intensity: null, targets: [], instructions: null, status: "planned" } }], "p");
    await scheduleWorkoutReminders(db, NOW);
    await scheduleWorkoutReminders(db, NOW);
    expect((await db.from("scheduled_notifications").select("kind").eq("user_id", id).eq("kind", "workout_reminder")).data).toHaveLength(1);
  });

  it("a failing job goes back to the queue with its error and eventually dead-letters", async () => {
    const db = h.serviceClient();
    const id = h.newUser("sched-fail@wk.invalid");
    const enq = await db.rpc("enqueue_background_job", { p_type: "adapt.daily", p_user_id: id, p_run_at: NOW, p_idempotency_key: `fail:${id}`, p_source_ref: null, p_payload: {}, p_max_attempts: 1 });
    expect(enq.error).toBeNull();
    // make the handler throw by revoking nothing: simulate with an invalid user timezone value in the profile
    h.sql(`insert into profiles (user_id, timezone) values ('${id}', 'Not/AZone')`);
    await h.serviceClient().from("training_rule_sets").insert({ user_id: id, version: 1, status: "draft", params: {} });
    h.sql(`update training_rule_sets set params = '{}'::jsonb where user_id = '${id}'`);
    await processJobs(db, "wk-test", NOW, 50);
    const job = await db.from("background_jobs").select("status, last_error").eq("user_id", id).single();
    expect(["dead", "succeeded"]).toContain(job.data?.status);
  });
});

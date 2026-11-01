import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RULE_SET_PARAMS, DailyCheckinInputSchema, MealItemInputSchema } from "@triatlo/shared";
import { AppleHealthScanner, batchFromAppleHealth, batchFromWorkouts, parseGpx } from "@triatlo/ingest";
import { mealTotals } from "@triatlo/domain";
import { analyzeMeal, callMealVision, readAiConfig, recordConsent, type AiConfig } from "./index";
import {
  type Ctx, applyUserChanges, approveAndApply, approveRuleSet, commitImport, createMeal, ensureActivePlan, ensureRuleSet, listAudit, listPlanHistory,
  listProposals, listWorkouts, loadDayContexts, rejectProposal, replaceAvailability, runDailyAdaptation, saveCheckin, saveProfile, saveReviewedMeal,
  setSessionStatus, undoToVersion, getPreferences, listAvailability, getProfile, DataError,
} from "./index";

/**
 * Integration tests: supabase-js -> (path-rewriting proxy) -> REAL PostgREST -> REAL PostgreSQL with the project's migrations.
 * Run with the env below (see supabase/tests/it.sh); skipped otherwise.
 */
const REST = process.env.TRIATLO_IT_REST_URL;
const DB = process.env.TRIATLO_IT_DATABASE_URL;
const SECRET = process.env.TRIATLO_IT_JWT_SECRET;
const enabled = Boolean(REST && DB && SECRET);

const b64 = (o: object | Buffer) => Buffer.from(o instanceof Buffer ? o : JSON.stringify(o)).toString("base64url");
function jwt(claims: Record<string, unknown>): string {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac("sha256", SECRET as string).update(body).digest("base64url")}`;
}
const sql = (statement: string) => execFileSync("psql", [DB as string, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8" }).trim();

let proxy: Server;
let url = "";
const newUser = (email: string) => { const id = randomUUID(); sql(`insert into auth.users (id, email) values ('${id}', '${email}')`); return id; };
const clientFor = (token: string | null) => createClient(url, "anon-key-ignored-by-postgrest", { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: token ? { Authorization: `Bearer ${token}` } : {} } });
const userCtx = (id: string): Ctx => ({ db: clientFor(jwt({ sub: id, role: "authenticated" })), userId: id });
const serviceCtx = (id: string): Ctx => ({ db: clientFor(jwt({ role: "service_role" })), userId: id });

beforeAll(async () => {
  if (!enabled) return;
  proxy = createServer(async (req, res) => {
    const target = `${REST}${(req.url ?? "").replace(/^\/rest\/v1/, "")}`;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && !["host", "connection", "content-length"].includes(k)) headers[k] = v;
    const r = await fetch(target, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "") ? undefined : Buffer.concat(chunks) });
    const out: Record<string, string> = {};
    r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "content-length"].includes(k)) out[k] = v; });
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});
afterAll(async () => { if (proxy) await new Promise((ok) => proxy.close(ok)); });

// "Now" is the REAL clock: the database stamps rows with its own clock, so a simulated future date would not match.
const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(NOW));
const d = (n: number) => { const [y, m, dd] = localToday.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const inHours = (h: number) => new Date(Date.parse(NOW) + h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

describe.skipIf(!enabled)("data layer over real PostgREST + RLS", () => {
  it("anonymous requests cannot read or write private records", async () => {
    const anon = clientFor(null);
    const read = await anon.from("daily_checkins").select("*");
    expect(read.error).not.toBeNull();
    const rpc = await anon.rpc("commit_plan_version", { p_plan_id: randomUUID(), p_expected_version: null, p_reason: "x", p_actor_kind: "user", p_actor_ref: null, p_proposal_id: null, p_revert_of: null, p_sessions: [], p_audit: { action: "plan_created", summary: "s" } });
    expect(rpc.error).not.toBeNull();
    const jobs = await clientFor(jwt({ sub: randomUUID(), role: "authenticated" })).from("background_jobs").select("*");
    expect(jobs.error).not.toBeNull();
  });

  it("profile, availability and check-in round trip; the shared context shows absent vs partial correctly", async () => {
    const ctx = userCtx(newUser("a@it.invalid"));
    await saveProfile(ctx, { displayName: "A", timezone: "America/Sao_Paulo", locale: "pt-BR" });
    expect((await getProfile(ctx))?.timezone).toBe("America/Sao_Paulo");
    await replaceAvailability(ctx, [{ weekday: 1, startsAt: "06:00", endsAt: "07:00", kind: "training", label: null }]);
    expect(await listAvailability(ctx)).toHaveLength(1);

    await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: "2026-11-02", fatigueScore: 4 }));
    await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: "2026-11-02", fatigueScore: 4, moodScore: 3 })); // same day: updates, no duplicate
    const days = await loadDayContexts(ctx, "2026-11-01", "2026-11-05");
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ day: "2026-11-02", fatigueScore: 4, moodScore: 3, checkinQuality: "partial", sleepMinutes: null, intakeRecorded: false });
  });

  it("plan: versions are immutable snapshots, manual edits and status changes are audited, history is kept", async () => {
    const ctx = userCtx(newUser("plan@it.invalid"));
    const plan = await ensureActivePlan(ctx);
    expect(plan).toMatchObject({ version: 1, sessions: [] });
    const sid = randomUUID();
    const after = await applyUserChanges(ctx, [{ type: "add_session", session: { id: sid, modality: "run", objective: null, startsAt: "2026-11-22T09:00:00Z", durationMinutes: 60, intensity: null, targets: [], instructions: null, status: "planned" } }], "Adicionei uma corrida");
    expect(after.version).toBe(2);
    await setSessionStatus(ctx, sid, "cancelled", "Cancelei por imprevisto");
    const now = await ensureActivePlan(ctx);
    expect(now.version).toBe(3);
    expect(now.sessions[0]?.status).toBe("cancelled");
    const history = await listPlanHistory(ctx, plan.planId);
    expect(history.map((h: { version: number }) => h.version)).toEqual([3, 2, 1]);
    const audit = await listAudit(ctx);
    expect(audit.filter((a: { action: string }) => a.action === "plan_version_applied")).toHaveLength(2);
    await expect(applyUserChanges(ctx, [{ type: "cancel_session", sessionId: randomUUID() }], "x")).rejects.toBeInstanceOf(DataError);
    // undo = new version restoring version 2 (the session is planned again)
    const v = await undoToVersion(ctx, plan.planId, 2);
    expect(v).toBe(4);
    expect((await ensureActivePlan(ctx)).sessions[0]?.status).toBe("planned");
  });

  it("two users never see each other's plan, context or proposals", async () => {
    const a = userCtx(newUser("iso-a@it.invalid")), b = userCtx(newUser("iso-b@it.invalid"));
    await applyUserChanges(a, [{ type: "add_session", session: { id: randomUUID(), modality: "swim", objective: null, startsAt: "2026-11-22T09:00:00Z", durationMinutes: 45, intensity: null, targets: [], instructions: null, status: "planned" } }], "A");
    await saveCheckin(a, DailyCheckinInputSchema.parse({ checkinDate: "2026-11-02", moodScore: 2 }));
    expect((await ensureActivePlan(b)).sessions).toHaveLength(0);
    expect(await loadDayContexts(b, "2026-11-01", "2026-11-30")).toHaveLength(0);
    expect(await listProposals(b)).toHaveLength(0);
  });

  async function seedWorseningUser(email: string, mode: "service" | "user") {
    const id = newUser(email);
    const ctx = mode === "service" ? serviceCtx(id) : userCtx(id);
    await saveProfile(mode === "service" ? userCtx(id) : ctx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
    for (let n = -12; n <= -2; n++) await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: d(n), fatigueScore: 2, energyScore: 4 }));
    for (const n of [-1, 0]) await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: d(n), fatigueScore: 4, energyScore: 2 }));
    const sessions = [
      { id: randomUUID(), modality: "run" as const, objective: null, startsAt: inHours(6), durationMinutes: 60, intensity: null, targets: [], instructions: null, status: "planned" as const },
      { id: randomUUID(), modality: "swim" as const, objective: null, startsAt: inHours(21), durationMinutes: 50, intensity: null, targets: [], instructions: null, status: "planned" as const },
    ];
    await applyUserChanges(userCtx(id), sessions.map((s) => ({ type: "add_session" as const, session: s })), "Plano da semana");
    return { id, ctx, userCtx: userCtx(id), sessions };
  }

  it("engine stays OFF until the user approves a rule set (draft is inactive); missing timezone is never assumed", async () => {
    const id = newUser("rules@it.invalid");
    const ctx = userCtx(id);
    expect(await runDailyAdaptation(ctx, NOW)).toEqual({ status: "timezone_missing" });
    await saveProfile(ctx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
    const draft = await ensureRuleSet(ctx);
    expect(draft).toMatchObject({ version: 1, status: "draft" });
    expect(draft.params).toEqual(DEFAULT_RULE_SET_PARAMS);
    expect(await runDailyAdaptation(ctx, NOW)).toEqual({ status: "rules_not_approved" });
    await approveRuleSet(ctx, draft.id, { enableAutoApply: false });
    expect(await getPreferences(ctx)).toMatchObject({ approvedLimitsVersion: "rules-v1", autoApplyEnabled: false });
    expect(await runDailyAdaptation(ctx, NOW)).toEqual({ status: "no_plan" });
  });

  it("WORKER path: approved rules + opt-in auto-apply => one conservative reduction applied as a new version, audited, then stable", async () => {
    const u = await seedWorseningUser("worker@it.invalid", "service");
    await approveRuleSet(u.userCtx, (await ensureRuleSet(u.userCtx)).id, { enableAutoApply: true });
    const before = await ensureActivePlan(u.userCtx);
    const run = await runDailyAdaptation(u.ctx, NOW, "worker-test");
    expect(run.status).toBe("applied");
    const after = await ensureActivePlan(u.userCtx);
    expect(after.version).toBe(before.version + 1);
    expect(after.sessions.map((s) => s.durationMinutes).sort()).toEqual([40, 48]);     // 50 -> 40 and 60 -> 48 (-20%), never up
    const applied = await listProposals(u.userCtx, ["applied"]);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.rationale.caveats).toMatch(/não é um diagnóstico/);
    const audit = await listAudit(u.userCtx);
    expect(audit.some((a: { action: string; actor_kind: string }) => a.action === "plan_version_applied" && a.actor_kind === "engine")).toBe(true);
    expect(audit.some((a: { action: string }) => a.action === "proposal_created")).toBe(true);
    // stability: running again the same day changes nothing
    expect((await runDailyAdaptation(u.ctx, NOW, "worker-test")).status).toBe("no_change");
    expect((await ensureActivePlan(u.userCtx)).version).toBe(after.version);
    // reversibility
    await undoToVersion(u.userCtx, before.planId, before.version);
    expect((await ensureActivePlan(u.userCtx)).sessions.map((s) => s.durationMinutes).sort()).toEqual([50, 60]);
  });

  it("WITHOUT the auto-apply opt-in the same situation only PROPOSES; the user approves (applies) or rejects", async () => {
    const u = await seedWorseningUser("approve@it.invalid", "user");
    await approveRuleSet(u.userCtx, (await ensureRuleSet(u.userCtx)).id, { enableAutoApply: false });
    const before = await ensureActivePlan(u.userCtx);
    const run = await runDailyAdaptation(u.userCtx, NOW);
    expect(run.status).toBe("proposed");
    expect((await ensureActivePlan(u.userCtx)).version).toBe(before.version);          // nothing changed without approval
    const [open] = await listProposals(u.userCtx);
    expect(open?.changeClass).toBe("auto_safe");
    const { appliedVersion } = await approveAndApply(u.userCtx, open!.id);
    expect(appliedVersion).toBe(before.version + 1);
    expect((await ensureActivePlan(u.userCtx)).sessions.map((s) => s.durationMinutes).sort()).toEqual([40, 48]);
    await expect(approveAndApply(u.userCtx, open!.id)).rejects.toBeInstanceOf(DataError);   // not open anymore

    const r = await seedWorseningUser("reject@it.invalid", "user");
    await approveRuleSet(r.userCtx, (await ensureRuleSet(r.userCtx)).id, { enableAutoApply: false });
    await runDailyAdaptation(r.userCtx, NOW);
    const [toReject] = await listProposals(r.userCtx);
    await rejectProposal(r.userCtx, toReject!.id);
    expect((await listProposals(r.userCtx, ["rejected"]))).toHaveLength(1);
    expect((await ensureActivePlan(r.userCtx)).sessions.map((s) => s.durationMinutes).sort()).toEqual([50, 60]);

    // a proposal whose plan moved on is discarded, never applied on stale data
    const s = await seedWorseningUser("stale@it.invalid", "user");
    await approveRuleSet(s.userCtx, (await ensureRuleSet(s.userCtx)).id, { enableAutoApply: false });
    await runDailyAdaptation(s.userCtx, NOW);
    const [stale] = await listProposals(s.userCtx);
    await applyUserChanges(s.userCtx, [{ type: "reschedule_session", sessionId: s.sessions[0]!.id, newStartsAt: inHours(7) }], "Mudei o horário");
    await expect(approveAndApply(s.userCtx, stale!.id)).rejects.toMatchObject({ code: "stale_proposal" });
    expect(await listProposals(s.userCtx, ["superseded"])).toHaveLength(1);
  });

  it("not enough real data => no proposal and a clear reason", async () => {
    const id = newUser("sparse@it.invalid"); const ctx = userCtx(id);
    await saveProfile(ctx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
    await approveRuleSet(ctx, (await ensureRuleSet(ctx)).id, { enableAutoApply: true });
    await applyUserChanges(ctx, [{ type: "add_session", session: { id: randomUUID(), modality: "run", objective: null, startsAt: inHours(6), durationMinutes: 60, intensity: null, targets: [], instructions: null, status: "planned" } }], "p");
    await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: d(-1), fatigueScore: 5 }));
    await saveCheckin(ctx, DailyCheckinInputSchema.parse({ checkinDate: d(0), fatigueScore: 5 }));
    const run = await runDailyAdaptation(ctx, NOW);
    expect(run).toMatchObject({ status: "insufficient_data" });
    expect((await listProposals(ctx))).toHaveLength(0);
  });

  it("file import is idempotent and keeps provenance; workouts and watch data land in the shared context", async () => {
    const ctx = userCtx(newUser("import@it.invalid"));
    await saveProfile(ctx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
    const gpx = `<gpx version="1.1" creator="TestWatchApp"><trk><type>running</type><trkseg><trkpt lat="-23.55" lon="-46.63"><time>2026-11-02T09:00:00Z</time></trkpt><trkpt lat="-23.56" lon="-46.63"><time>2026-11-02T09:30:00Z</time></trkpt></trkseg></trk></gpx>`;
    const batch = batchFromWorkouts([parseGpx(gpx)]);
    const first = await commitImport(ctx, batch, { sourceId: "gpx", fileName: "run.gpx", fileSha256: "abc" });
    const second = await commitImport(ctx, batch, { sourceId: "gpx", fileName: "run.gpx", fileSha256: "abc" });
    expect(first).toMatchObject({ received: 1, inserted: 1, skipped: 0 });
    expect(second).toMatchObject({ received: 1, inserted: 0, skipped: 1 });
    expect(await listWorkouts(ctx)).toHaveLength(1);
    const prov = await ctx.db.from("data_import_provenance").select("status, records_inserted, source_kind, file_name").order("started_at");
    expect((prov.data ?? []).map((p: { status: string }) => p.status)).toEqual(["succeeded", "succeeded"]);

    const apple = new AppleHealthScanner();
    apple.push(`<HealthData><Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Zepp" unit="count/min" startDate="2026-11-02 00:00:00 -0300" endDate="2026-11-02 00:00:00 -0300" value="52"/>
      <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Zepp" startDate="2026-11-01 23:00:00 -0300" endDate="2026-11-02 06:30:00 -0300" value="HKCategoryValueSleepAnalysisAsleepCore"/></HealthData>`);
    apple.finish();
    const ab = batchFromAppleHealth(apple, new Set(["Zepp"]));
    await commitImport(ctx, ab, { sourceId: "apple-health-export", fileName: "export.xml", fileSha256: "def" });
    const again = await commitImport(ctx, ab, { sourceId: "apple-health-export", fileName: "export.xml", fileSha256: "def" });
    expect(again.inserted).toBe(0);
    const days = await loadDayContexts(ctx, "2026-11-02", "2026-11-02");
    expect(days[0]).toMatchObject({ sleepMinutes: 450, sleepSource: "file_import", restingHeartRate: 52, workoutCount: 1, workoutMinutes: 30 });
  });

  describe("meal photo analysis (mock provider, real database)", () => {
    const cfg: AiConfig = { provider: "openai", apiKey: "test-key", model: "test-model", baseUrl: "https://provider.invalid/v1", dailyCallLimit: 2 };
    const image = { base64: "AAAA", mimeType: "image/jpeg" as const };
    const answer = (content: unknown, ok = true, status = 200) => async () => ({ ok, status, json: async () => ({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }), text: async () => "" });
    const good = { isFood: true, overallConfidence: "medium", uncertaintyNotes: "óleo não visível", items: [{ name: "arroz", quantity: 150, unit: "g", confidence: "medium", energyKcal: 190, proteinG: null, carbohydrateG: 42, fatG: null }] };

    it("sends NOTHING without recorded consent, and nothing at all when AI is not configured", async () => {
      const ctx = userCtx(newUser("ai-consent@it.invalid"));
      const meal = await createMeal(ctx, { eatenAt: NOW, mealType: "lunch", notes: null, photoPath: null });
      let called = 0;
      const spy = async () => { called++; return { ok: true, status: 200, json: async () => ({}), text: async () => "" }; };
      expect(await analyzeMeal(ctx, meal, image, null, spy)).toEqual({ status: "ai_not_configured" });
      expect(await analyzeMeal(ctx, meal, image, cfg, spy)).toEqual({ status: "consent_required" });
      expect(called).toBe(0);
    });

    it("stores a validated, UNREVIEWED analysis and logs the call with data categories only", async () => {
      const ctx = userCtx(newUser("ai-ok@it.invalid"));
      await recordConsent(ctx, true);
      const meal = await createMeal(ctx, { eatenAt: NOW, mealType: "lunch", notes: null, photoPath: null });
      const out = await analyzeMeal(ctx, meal, image, cfg, answer(good));
      expect(out.status).toBe("succeeded");
      const a = await ctx.db.from("meal_analyses").select("status, confidence, result, provider, model, reviewed_at").eq("meal_id", meal).single();
      expect(a.data).toMatchObject({ status: "succeeded", confidence: "medium", provider: "openai", model: "test-model", reviewed_at: null });
      const calls = await ctx.db.from("ai_calls").select("status, data_categories, input_tokens, output_tokens, purpose");
      expect(calls.data).toEqual([{ status: "ok", data_categories: ["meal_photo"], input_tokens: 11, output_tokens: 7, purpose: "meal_photo" }]);
    });

    it("rejects invalid or hostile model output instead of saving it", async () => {
      const ctx = userCtx(newUser("ai-bad@it.invalid"));
      await recordConsent(ctx, true);
      const meal = await createMeal(ctx, { eatenAt: NOW, mealType: "lunch", notes: null, photoPath: null });
      const out = await analyzeMeal(ctx, meal, image, cfg, answer({ ...good, diagnosis: "x" }));
      expect(out).toMatchObject({ status: "failed", reason: "invalid_model_output" });
      const a = await ctx.db.from("meal_analyses").select("status, result, error").eq("meal_id", meal).single();
      expect(a.data).toMatchObject({ status: "failed", result: null, error: "invalid_model_output" });
      expect((await analyzeMeal(ctx, meal, image, cfg, answer("not json at all"))).status).toBe("failed");
      expect((await analyzeMeal(ctx, meal, image, cfg, answer("", false, 500))).status).toBe("failed");
    });

    it("enforces the daily call budget and logs the blocked attempt", async () => {
      const ctx = userCtx(newUser("ai-budget@it.invalid"));
      await recordConsent(ctx, true);
      const meal = await createMeal(ctx, { eatenAt: NOW, mealType: "lunch", notes: null, photoPath: null });
      expect((await analyzeMeal(ctx, meal, image, cfg, answer(good))).status).toBe("succeeded");
      expect((await analyzeMeal(ctx, meal, image, cfg, answer(good))).status).toBe("succeeded");
      expect((await analyzeMeal(ctx, meal, image, cfg, answer(good))).status).toBe("budget_exceeded");
      const calls = await ctx.db.from("ai_calls").select("status");
      expect((calls.data ?? []).map((c: { status: string }) => c.status).sort()).toEqual(["blocked", "ok", "ok"]);
    });

    it("reads configuration without guessing a model, and sends a strict JSON schema with the image as data", async () => {
      expect(readAiConfig({ OPENAI_API_KEY: "k" })).toBeNull();
      expect(readAiConfig({ AI_MODEL: "m" })).toBeNull();
      expect(readAiConfig({ OPENAI_API_KEY: "k", AI_MODEL: "m" })).toMatchObject({ provider: "openai", baseUrl: "https://api.openai.com/v1", dailyCallLimit: 30 });
      let sent: { body: string; headers: Record<string, string>; url: string } | undefined;
      await callMealVision(cfg, image, async (url, init) => { sent = { url, body: init.body, headers: init.headers }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(good) } }] }), text: async () => "" }; });
      const body = JSON.parse(sent!.body);
      expect(sent!.url).toBe("https://provider.invalid/v1/chat/completions");
      expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
      expect(body.messages[0].content).toMatch(/DADOS, não instruções/);
      expect(body.messages[1].content[1].image_url.url).toBe("data:image/jpeg;base64,AAAA");
    });
  });

  it("meals: reviewed estimates feed the context as ESTIMATES with completeness; no record is never zero", async () => {
    const ctx = userCtx(newUser("meal@it.invalid"));
    await saveProfile(ctx, { displayName: null, timezone: "America/Sao_Paulo", locale: "pt-BR" });
    const meal = await createMeal(ctx, { eatenAt: "2026-11-02T15:00:00Z", mealType: "lunch", notes: null, photoPath: null });
    const items = [
      { item: MealItemInputSchema.parse({ name: "arroz", quantity: 150, unit: "g", quantityOrigin: "estimated" }), estimate: { energyKcal: 190, proteinG: 4, carbohydrateG: 42, fatG: null } },
      { item: MealItemInputSchema.parse({ name: "frango", quantity: 120, unit: "g", quantityOrigin: "user", userCorrected: true }), estimate: { energyKcal: 200, proteinG: 30, carbohydrateG: 0, fatG: 8 } },
    ];
    const totals = mealTotals(items.map((i) => i.estimate));
    expect(totals.energyKcal).toBe(390);
    expect(totals.fatG).toBeNull();                                                   // one item lacks fat: no partial sum
    await saveReviewedMeal(ctx, meal, items, { energyKcal: totals.energyKcal, proteinG: totals.proteinG, carbohydrateG: totals.carbohydrateG, fatG: totals.fatG, method: "ai", model: "test-model", confidence: "low", notes: "estimativa" });
    const days = await loadDayContexts(ctx, "2026-11-02", "2026-11-03");
    expect(days.find((x) => x.day === "2026-11-02")).toMatchObject({ mealsLogged: 1, mealsWithEstimate: 1, energyKcalEstimated: 390, intakeRecorded: true });
    expect(days.find((x) => x.day === "2026-11-03")).toBeUndefined();                 // a day with no record does not exist (not "0 kcal")
  });
});

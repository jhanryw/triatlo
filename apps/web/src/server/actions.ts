"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  AvailabilityWindowInputSchema, CompletedWorkoutInputSchema, DailyCheckinInputSchema, MEAL_TYPES, MODALITIES, ProfileSchema, SESSION_STATUSES,
  type Modality, type PlannedSession,
} from "@triatlo/shared";
import { addDaysToDate, localToUtcIso, mealTotals, planWeek, utcToLocalDate } from "@triatlo/domain";
import {
  type Ctx, DataError, analyzeMeal, applyUserChanges, approveAndApply, approveRuleSet, createMeal, ensureActivePlan, ensureRuleSet, getProfile,
  listAvailability, logWorkout, readAiConfig, recordConsent, rejectProposal, replaceAvailability, saveCheckin, saveProfile, saveReviewedMeal,
  runDailyAdaptation, setSessionStatus, undoToVersion,
} from "@triatlo/data";
import { requireSession } from "./ctx";
import { int, num, str } from "./form";

/** Runs one user action; shows its outcome on the page it came from. Never leaks internals: only DataError/validation texts. */
async function act(formData: FormData, fallbackPath: string, run: (ctx: Ctx, timezone: string | null) => Promise<string | void>): Promise<never> {
  const back = str(formData, "return") ?? fallbackPath;
  const path = back.startsWith("/") && !back.startsWith("//") ? back : fallbackPath;
  const { ctx, timezone } = await requireSession();
  let outcome: { ok: string } | { erro: string };
  try {
    outcome = { ok: (await run(ctx, timezone)) ?? "Salvo." };
  } catch (e) {
    outcome = { erro: e instanceof DataError || e instanceof UserError ? e.message : e instanceof Error && e.name === "ZodError" ? "Dados inválidos. Revise os campos." : "Não foi possível concluir. Tente novamente." };
  }
  revalidatePath("/", "layout");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${"ok" in outcome ? `ok=${encodeURIComponent(outcome.ok)}` : `erro=${encodeURIComponent(outcome.erro)}`}`);
}

class UserError extends Error {}
const needZone = (tz: string | null): string => {
  if (!tz) throw new UserError("Defina seu fuso horário em Configurações antes de continuar.");
  return tz;
};
const todayIn = (tz: string): string => utcToLocalDate(new Date().toISOString(), tz);

export async function saveCheckinAction(formData: FormData): Promise<void> {
  await act(formData, "/", async (ctx, tz) => {
    const input = DailyCheckinInputSchema.parse({
      checkinDate: todayIn(needZone(tz)), sleepQualityScore: int(formData, "sleep"), fatigueScore: int(formData, "fatigue"), energyScore: int(formData, "energy"),
      moodScore: int(formData, "mood"), recoveryScore: int(formData, "recovery"), notes: str(formData, "notes"),
    });
    await saveCheckin(ctx, input);
    return "Check-in salvo.";
  });
}

export async function sessionStatusAction(formData: FormData): Promise<void> {
  await act(formData, "/workouts", async (ctx) => {
    const sessionId = str(formData, "sessionId");
    const status = str(formData, "status");
    if (!sessionId || !status || !(SESSION_STATUSES as readonly string[]).includes(status)) throw new UserError("Pedido inválido.");
    const plan = await ensureActivePlan(ctx);
    const session = plan.sessions.find((s) => s.id === sessionId);
    if (!session) throw new UserError("Sessão não encontrada no plano atual.");
    if (status === "completed" || status === "partial") {
      // The workout record carries only what the user told us; unknown stays unknown.
      const rpeValue = num(formData, "rpe");
      const workout = CompletedWorkoutInputSchema.parse({
        plannedSessionId: sessionId, modality: session.modality, completion: status, startedAt: session.startsAt, durationMinutes: int(formData, "duration"),
        distanceMeters: num(formData, "distanceKm") === null ? null : (num(formData, "distanceKm") as number) * 1000, avgHeartRateBpm: int(formData, "avgHr"),
        perceivedExertionScale: rpeValue === null ? null : "rpe_1_10", perceivedExertionValue: rpeValue, notes: str(formData, "notes"),
        quality: status === "partial" ? "partial" : "complete",
      });
      await logWorkout(ctx, workout);
    }
    await setSessionStatus(ctx, sessionId, status as PlannedSession["status"], `Sessão marcada como ${status}`);
    return "Sessão atualizada.";
  });
}

export async function addSessionAction(formData: FormData): Promise<void> {
  await act(formData, "/workouts", async (ctx, tz) => {
    const modality = str(formData, "modality") as Modality | null;
    const date = str(formData, "date");
    const time = str(formData, "time");
    const duration = int(formData, "duration");
    if (!modality || !(MODALITIES as readonly string[]).includes(modality) || !date || !time || !duration || duration <= 0) throw new UserError("Informe modalidade, data, hora e duração.");
    const session: PlannedSession = {
      id: randomUUID(), modality, objective: str(formData, "objective"), startsAt: localToUtcIso(date, time, needZone(tz)), durationMinutes: duration,
      intensity: null, targets: [], instructions: null, status: "planned",
    };
    await applyUserChanges(ctx, [{ type: "add_session", session }], `Sessão adicionada: ${modality}`);
    return "Sessão adicionada.";
  });
}

export async function cancelSessionAction(formData: FormData): Promise<void> {
  await act(formData, "/workouts", async (ctx) => {
    const sessionId = str(formData, "sessionId");
    if (!sessionId) throw new UserError("Pedido inválido.");
    await applyUserChanges(ctx, [{ type: "cancel_session", sessionId }], "Sessão cancelada pelo usuário");
    return "Sessão cancelada, sem penalidade.";
  });
}

const PLAN_MODALITIES = ["swim", "bike_indoor", "run", "strength"] as const;

/** Places the sessions the user asked for into their availability windows. Counts and durations are the user's, never invented. */
export async function planWeekAction(formData: FormData): Promise<void> {
  await act(formData, "/workouts", async (ctx, tz) => {
    const zone = needZone(tz);
    const requests = PLAN_MODALITIES.flatMap((m) => {
      const count = int(formData, `${m}_count`) ?? 0;
      const duration = int(formData, `${m}_duration`);
      if (count <= 0) return [];
      if (!duration || duration <= 0) throw new UserError("Informe a duração de cada modalidade escolhida.");
      return [{ modality: m, count, durationMinutes: duration, preferWeekend: m === "bike_indoor" || m === "run" }];
    });
    if (requests.length === 0) throw new UserError("Escolha ao menos uma sessão.");
    const windows = (await listAvailability(ctx)).filter((w) => w.kind === "training");
    if (windows.length === 0) throw new UserError("Cadastre suas janelas de treino em Configurações primeiro.");
    const plan = await ensureActivePlan(ctx);
    const weekStart = str(formData, "weekStart") ?? addDaysToDate(todayIn(zone), 1);
    const result = planWeek({
      weekStart, timeZone: zone, requests, windows,
      existing: plan.sessions.filter((s) => s.status !== "cancelled").map((s) => ({ startsAt: s.startsAt, durationMinutes: s.durationMinutes })),
    });
    if (result.placements.length > 0) {
      await applyUserChanges(ctx, result.placements.map((p) => ({
        type: "add_session" as const,
        session: { id: randomUUID(), modality: p.modality, objective: null, startsAt: p.startsAt, durationMinutes: p.durationMinutes, intensity: null, targets: [], instructions: null, status: "planned" as const },
      })), `Semana de ${weekStart} planejada (${result.placements.length} sessões)`);
    }
    const left = result.unplaced.length;
    return `${result.placements.length} sessão(ões) posicionada(s)${left ? `; ${left} não coube(ram) nas suas janelas` : ""}.`;
  });
}

export async function undoAction(formData: FormData): Promise<void> {
  await act(formData, "/workouts", async (ctx) => {
    const planId = str(formData, "planId");
    const version = int(formData, "version");
    if (!planId || !version) throw new UserError("Pedido inválido.");
    await undoToVersion(ctx, planId, version);
    return `Plano revertido para a versão ${version} (nova versão criada; o histórico é mantido).`;
  });
}

export async function approveProposalAction(formData: FormData): Promise<void> {
  await act(formData, "/", async (ctx) => {
    const id = str(formData, "proposalId");
    if (!id) throw new UserError("Pedido inválido.");
    const { appliedVersion } = await approveAndApply(ctx, id);
    return `Proposta aprovada e aplicada (versão ${appliedVersion}). Dá para desfazer em Treinos.`;
  });
}

export async function rejectProposalAction(formData: FormData): Promise<void> {
  await act(formData, "/", async (ctx) => {
    const id = str(formData, "proposalId");
    if (!id) throw new UserError("Pedido inválido.");
    await rejectProposal(ctx, id);
    return "Proposta recusada. Nada foi alterado.";
  });
}

export async function saveProfileAction(formData: FormData): Promise<void> {
  await act(formData, "/settings", async (ctx) => {
    const current = await getProfile(ctx);
    await saveProfile(ctx, ProfileSchema.parse({ displayName: str(formData, "displayName"), timezone: str(formData, "timezone"), locale: current?.locale ?? "pt-BR" }));
    return "Perfil salvo.";
  });
}

export async function saveAvailabilityAction(formData: FormData): Promise<void> {
  await act(formData, "/settings", async (ctx) => {
    const windows = [];
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      const startsAt = str(formData, `start_${weekday}`);
      const endsAt = str(formData, `end_${weekday}`);
      if (!startsAt && !endsAt) continue;
      windows.push(AvailabilityWindowInputSchema.parse({ weekday, startsAt, endsAt, kind: "training", label: null }));
    }
    await replaceAvailability(ctx, windows);
    return "Janelas de treino salvas.";
  });
}

export async function approveRulesAction(formData: FormData): Promise<void> {
  await act(formData, "/settings", async (ctx) => {
    const ruleSet = await ensureRuleSet(ctx);
    await approveRuleSet(ctx, ruleSet.id, { enableAutoApply: formData.get("autoApply") === "on" });
    return `Regras v${ruleSet.version} aprovadas por você.`;
  });
}

export async function aiConsentAction(formData: FormData): Promise<void> {
  await act(formData, "/settings", async (ctx) => {
    const granted = formData.get("grant") === "1";
    await recordConsent(ctx, granted);
    return granted ? "Consentimento registrado." : "Consentimento retirado: nada mais será enviado à IA.";
  });
}

const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

/** Stores the photo privately, creates the meal and (only with consent + configured provider) asks the AI for an ESTIMATE to review. */
export async function uploadMealAction(formData: FormData): Promise<void> {
  const { ctx, timezone } = await requireSession();
  let target = "/nutrition";
  let message: { ok: string } | { erro: string };
  try {
    const mealType = str(formData, "mealType");
    if (!mealType || !(MEAL_TYPES as readonly string[]).includes(mealType)) throw new UserError("Escolha o tipo da refeição.");
    const file = formData.get("photo");
    const hasPhoto = file instanceof File && file.size > 0;
    let photoPath: string | null = null;
    let bytes: Buffer | null = null;
    let mime: keyof typeof PHOTO_TYPES | null = null;
    if (hasPhoto) {
      if (!(file.type in PHOTO_TYPES)) throw new UserError("Use uma foto JPEG, PNG ou WebP.");
      if (file.size > 10 * 1024 * 1024) throw new UserError("A foto passa de 10 MB.");
      mime = file.type as keyof typeof PHOTO_TYPES;
      bytes = Buffer.from(await file.arrayBuffer());
      photoPath = `${ctx.userId}/${randomUUID()}.${PHOTO_TYPES[mime]}`;
      const up = await ctx.db.storage.from("meal-photos").upload(photoPath, bytes, { contentType: mime, upsert: false });
      if (up.error) throw new DataError("Não foi possível guardar a foto.");
    }
    const mealId = await createMeal(ctx, { eatenAt: new Date().toISOString().replace(".000Z", "Z"), mealType: mealType as (typeof MEAL_TYPES)[number], notes: str(formData, "notes"), photoPath });
    target = `/nutrition/review/${mealId}`;
    message = { ok: "Refeição criada. Revise e corrija antes de salvar." };
    if (bytes && mime) {
      const outcome = await analyzeMeal(ctx, mealId, { base64: bytes.toString("base64"), mimeType: mime }, readAiConfig(process.env));
      const texts: Record<string, string> = {
        ai_not_configured: "A análise por IA não está configurada neste ambiente; preencha os itens manualmente.",
        consent_required: "Você ainda não autorizou o envio de fotos à IA (Configurações). Preencha manualmente.",
        budget_exceeded: "O limite diário de análises por IA foi atingido. Preencha manualmente.",
        failed: "A análise por IA falhou. Preencha manualmente.",
      };
      if (outcome.status !== "succeeded") message = { ok: texts[outcome.status] ?? texts.failed! };
    }
  } catch (e) {
    message = { erro: e instanceof DataError || e instanceof UserError ? e.message : "Não foi possível registrar a refeição." };
  }
  void timezone;
  revalidatePath("/", "layout");
  redirect(`${target}${"ok" in message ? `?ok=${encodeURIComponent(message.ok)}` : `?erro=${encodeURIComponent(message.erro)}`}`);
}

/** Saves the user's reviewed version of a meal. Whatever the user typed is a user value; AI values stay flagged as estimates. */
export async function saveReviewedMealAction(formData: FormData): Promise<void> {
  const mealId = str(formData, "mealId");
  await act(formData, mealId ? `/nutrition/review/${mealId}` : "/nutrition", async (ctx) => {
    if (!mealId) throw new UserError("Pedido inválido.");
    const count = int(formData, "itemCount") ?? 0;
    const items = [];
    let anyAi = false;
    for (let i = 0; i < count; i += 1) {
      const name = str(formData, `name_${i}`);
      if (!name || formData.get(`remove_${i}`) === "on") continue;
      const quantity = num(formData, `quantity_${i}`);
      const unit = str(formData, `unit_${i}`);
      const estimate = { energyKcal: num(formData, `kcal_${i}`), proteinG: num(formData, `protein_${i}`), carbohydrateG: num(formData, `carbs_${i}`), fatG: num(formData, `fat_${i}`) };
      // A row that came from the AI is "corrected" when ANY visible value differs from what the AI proposed; rows the user typed are user values.
      const proposedName = str(formData, `orig_name_${i}`);
      const fromAi = proposedName !== null;
      anyAi ||= fromAi;
      const same = fromAi && proposedName === name && num(formData, `orig_quantity_${i}`) === quantity && str(formData, `orig_unit_${i}`) === unit
        && num(formData, `orig_kcal_${i}`) === estimate.energyKcal && num(formData, `orig_protein_${i}`) === estimate.proteinG
        && num(formData, `orig_carbs_${i}`) === estimate.carbohydrateG && num(formData, `orig_fat_${i}`) === estimate.fatG;
      const complete = quantity !== null && unit !== null;
      items.push({
        item: { name, quantity: complete ? quantity : null, unit: complete ? unit : null, quantityOrigin: same ? "estimated" as const : "user" as const, userCorrected: !same },
        estimate,
      });
    }
    const totals = mealTotals(items.map((x) => x.estimate));
    const confidence = str(formData, "confidence");
    const any = [totals.energyKcal, totals.proteinG, totals.carbohydrateG, totals.fatG].some((v) => v !== null);
    await saveReviewedMeal(ctx, mealId, items, any ? {
      energyKcal: totals.energyKcal, proteinG: totals.proteinG, carbohydrateG: totals.carbohydrateG, fatG: totals.fatG,
      method: anyAi && items.every((x) => !x.item.userCorrected) ? "ai" as const : "manual" as const, model: str(formData, "model"),
      confidence: confidence === "low" || confidence === "medium" || confidence === "high" ? confidence : null,
      notes: totals.incomplete.length ? `Totais ausentes por falta de estimativa em algum item: ${totals.incomplete.join(", ")}` : null,
    } : null);
    return "Refeição salva (valores são estimativas).";
  });
}

/** Runs the same daily evaluation the worker runs, on demand. Proposals still need approval unless the user enabled auto-apply. */
export async function runAnalysisNowAction(formData: FormData): Promise<void> {
  await act(formData, "/assistant", async (ctx) => {
    const result = await runDailyAdaptation(ctx, new Date().toISOString().replace(".000Z", "Z"), "user-request");
    switch (result.status) {
      case "timezone_missing": return "Defina seu fuso horário em Configurações.";
      case "rules_not_approved": return "As regras ainda não foram aprovadas por você (Configurações). Nada é proposto sem elas.";
      case "no_plan": return "Não há sessões no plano para avaliar.";
      case "insufficient_data": return `Dados insuficientes: ${result.detail}`;
      case "no_change": return `Nenhuma mudança necessária. ${result.detail}`;
      case "proposed": return "Há uma proposta aguardando sua decisão em Hoje.";
      case "applied": return "Uma redução dentro dos limites que você aprovou foi aplicada. Dá para desfazer em Treinos.";
    }
  });
}

import type { ChangeClass, DataQuality, DataRef, Modality, PlanChange, Rationale, RuleSetParams, SessionStatus } from "@triatlo/shared";
import { dateRange } from "./availability";
import { type DayContext, type MetricKey, indexByDay, median, metricValue } from "./daily-context";

/**
 * Deterministic adaptation rules (v0). What this module does and does NOT do:
 *  - It can only propose REDUCTIONS of the duration of already-planned sessions. It never increases load and never
 *    produces progressions: those are not rule outputs.
 *  - Every trigger is relative to the PERSON'S OWN baseline (median of their own recent days). No absolute clinical
 *    thresholds. No diagnosis.
 *  - Unknown data never triggers anything and breaks a streak (absence is neither "fine" nor "bad").
 *  - Subjective reports are never dismissed because the watch looks fine: a disagreement is reported as a conflict,
 *    lowers the declared data quality, and the (conservative) reduction is still proposed.
 *  - Whether a proposal may be applied automatically is NOT decided here: it only labels its class; the autonomy
 *    gate (decideApplication) requires an approved rule set AND the user's auto-apply opt-in.
 */

export interface UpcomingSession {
  sessionId: string;
  modality: Modality;
  startsAt: string;
  durationMinutes: number | null;
  status: SessionStatus;
  /** When this session was last changed by an applied proposal (null = never). */
  lastChangedAt: string | null;
  hasOpenProposal: boolean;
}

export interface AdaptationInput {
  now: string;
  /** Today's local date (YYYY-MM-DD) in the user's timezone. */
  today: string;
  params: RuleSetParams;
  ruleSetVersion: number;
  days: readonly DayContext[];
  upcoming: readonly UpcomingSession[];
  /** Proposals created in the last 7 days (any status). */
  proposalsLast7Days: number;
  planId: string;
  baseVersion: number;
}

export type WindowDayState = "worse" | "not_worse" | "unknown";

export interface DaySignal {
  day: string;
  state: WindowDayState;
  /** Human-readable reasons, e.g. "fadiga acima da sua mediana (4 vs 2)". */
  reasons: string[];
}

export interface SignalReport {
  window: DaySignal[];
  usableMetrics: MetricKey[];
  baselines: Partial<Record<MetricKey, number>>;
  conflict: boolean;
  sustainedWorsening: boolean;
}

export interface ProposalDraft {
  planId: string;
  baseVersion: number;
  changeClass: ChangeClass;
  trigger: { type: "daily" | "event" | "manual"; ref: string | null };
  changes: PlanChange[];
  rationale: Rationale;
  /** Sessions touched by this single proposal (one plan version, one decision). */
  sessionIds: string[];
}

export type AdaptationOutcome =
  | { outcome: "insufficient_data"; knownDays: number; needed: number; message: string; signals: SignalReport | null }
  | { outcome: "no_change"; reasons: string[]; signals: SignalReport }
  | { outcome: "proposals"; proposals: ProposalDraft[]; signals: SignalReport };

const SUBJECTIVE: ReadonlyArray<{ key: MetricKey; label: string; higherIsWorse: boolean }> = [
  { key: "fatigue", label: "fadiga", higherIsWorse: true },
  { key: "energy", label: "disposição", higherIsWorse: false },
  { key: "mood", label: "humor", higherIsWorse: false },
  { key: "recovery", label: "recuperação percebida", higherIsWorse: false },
  { key: "sleepQuality", label: "qualidade do sono percebida", higherIsWorse: false },
];

const NON_REDUCIBLE: ReadonlySet<Modality> = new Set<Modality>(["rest", "recovery"]);
const HOUR_MS = 3_600_000;

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function hasRecoveryData(d: DayContext): boolean {
  return [d.fatigueScore, d.energyScore, d.moodScore, d.recoveryScore, d.sleepQualityScore, d.sleepMinutes].some((v) => v !== null);
}

export function evaluateAdaptation(input: AdaptationInput): AdaptationOutcome {
  const { params, today } = input;
  const byDay = indexByDay(input.days);
  const windowStart = addDays(today, -(params.subjective.consecutiveDays - 1));
  const baselineEnd = addDays(windowStart, -1);
  const baselineStart = addDays(baselineEnd, -(params.lookbackDays - 1));

  // 1. Data sufficiency over the whole lookback (window included): real data days, not calendar days.
  const lookback = dateRange(addDays(today, -(params.lookbackDays - 1)), today);
  const knownDays = lookback.filter((d) => {
    const ctx = byDay.get(d);
    return ctx !== undefined && hasRecoveryData(ctx);
  }).length;
  if (knownDays < params.minKnownDays) {
    return {
      outcome: "insufficient_data",
      knownDays,
      needed: params.minKnownDays,
      message: `Dados insuficientes: ${knownDays} dia(s) com registro nos últimos ${params.lookbackDays} (mínimo ${params.minKnownDays}). Nenhum ajuste é proposto sem dados reais.`,
      signals: null,
    };
  }

  // 2. Personal baselines from the days BEFORE the recent window (so the problem does not hide in its own baseline).
  const baselineDays = dateRange(baselineStart, baselineEnd).map((d) => byDay.get(d)).filter((d): d is DayContext => d !== undefined);
  const metrics: MetricKey[] = [...SUBJECTIVE.map((s) => s.key), "sleepMinutes", "restingHeartRate"];
  const baselines: Partial<Record<MetricKey, number>> = {};
  for (const key of metrics) {
    const known = baselineDays.map((d) => metricValue(d, key)).filter((v): v is number => v !== null);
    const m = known.length >= params.minKnownDays ? median(known) : null;
    if (m !== null) baselines[key] = m;
  }
  const usableMetrics = Object.keys(baselines) as MetricKey[];

  // 3. Classify each day of the recent window.
  const windowDays = dateRange(windowStart, today);
  let conflict = false;
  const window: DaySignal[] = windowDays.map((date) => {
    const ctx = byDay.get(date);
    if (!ctx) return { day: date, state: "unknown" as const, reasons: [] };
    const reasons: string[] = [];
    let anyKnown = false;
    for (const s of SUBJECTIVE) {
      const base = baselines[s.key];
      const value = metricValue(ctx, s.key);
      if (base === undefined || value === null) continue;
      anyKnown = true;
      const delta = s.higherIsWorse ? value - base : base - value;
      if (delta >= params.subjective.minPointsWorse) {
        reasons.push(`${s.label} ${s.higherIsWorse ? "acima" : "abaixo"} da sua mediana recente (${value} vs ${base})`);
      }
    }
    const sleepBase = baselines.sleepMinutes;
    if (sleepBase !== undefined && ctx.sleepMinutes !== null) {
      anyKnown = true;
      if (ctx.sleepMinutes < sleepBase * (1 - params.sleep.shortfallFraction)) {
        reasons.push(`sono mais curto que a sua mediana recente (${ctx.sleepMinutes} vs ${Math.round(sleepBase)} min)`);
      }
    }
    if (!anyKnown) return { day: date, state: "unknown" as const, reasons: [] };
    if (reasons.length > 0) {
      const rhrBase = baselines.restingHeartRate;
      if (rhrBase !== undefined && ctx.restingHeartRate !== null && ctx.restingHeartRate <= rhrBase) conflict = true;
      return { day: date, state: "worse" as const, reasons };
    }
    return { day: date, state: "not_worse" as const, reasons: [] };
  });

  const sustained = window.every((d) => d.state === "worse");
  const signals: SignalReport = { window, usableMetrics, baselines, conflict: sustained && conflict, sustainedWorsening: sustained };

  if (!sustained) {
    const unknownDays = window.filter((d) => d.state === "unknown").length;
    return {
      outcome: "no_change",
      signals,
      reasons: [
        unknownDays > 0
          ? `${unknownDays} dia(s) da janela sem dados: dado ausente não conta como piora nem como normalidade; nenhum ajuste.`
          : "Sem piora sustentada em relação à sua própria linha de base.",
      ],
    };
  }

  // 4. Sustained worsening -> conservative reduction proposals for upcoming sessions, rate-limited and stable.
  const now = Date.parse(input.now);
  const horizonEnd = now + params.horizonHours * HOUR_MS;
  const remaining = Math.max(0, params.stability.maxProposalsPerWeek - input.proposalsLast7Days);
  const eligible = input.upcoming
    .filter((s) => {
      const start = Date.parse(s.startsAt);
      if (s.status !== "planned" || NON_REDUCIBLE.has(s.modality) || s.durationMinutes === null || s.hasOpenProposal) return false;
      if (!(start > now && start <= horizonEnd)) return false;
      if (s.lastChangedAt !== null && now - Date.parse(s.lastChangedAt) < params.stability.minHoursBetweenChangesPerSession * HOUR_MS) return false;
      return true;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, remaining);

  if (eligible.length === 0) {
    return { outcome: "no_change", signals, reasons: ["Piora sustentada detectada, mas não há sessão elegível (no horizonte, não alterada recentemente, sem proposta aberta) ou o limite semanal de propostas foi atingido."] };
  }

  const quality: DataQuality = signals.conflict ? "conflicting" : windowDays.every((d) => byDay.get(d)?.checkinQuality === "complete") ? "complete" : "partial";
  const reasonText = [...new Set(window.flatMap((d) => d.reasons.map((r) => r.replace(/ \(.*\)$/, ""))))].join("; ");
  const dataRefs: DataRef[] = windowDays.map((d) => ({ kind: "day_context", id: d, observedAt: null }));
  const caveats = [
    "Baseado em autorrelato e nos dados disponíveis; não é um diagnóstico e não substitui avaliação profissional.",
    signals.conflict ? "Seus relatos e os dados do relógio divergem (frequência cardíaca de repouso dentro da sua mediana): o relato foi mantido e a divergência registrada." : null,
  ].filter((c): c is string => c !== null).join(" ");

  const pct = Math.round(params.reduction.durationFraction * 100);
  const lines = eligible.map((s) => {
    const from = s.durationMinutes as number;
    return { id: s.sessionId, from, to: Math.max(1, Math.round(from * (1 - params.reduction.durationFraction))) };
  });
  const proposals: ProposalDraft[] = [
    {
      planId: input.planId,
      baseVersion: input.baseVersion,
      sessionIds: lines.map((l) => l.id),
      changeClass: params.reduction.durationFraction <= params.reduction.maxAutoFraction ? "auto_safe" : "needs_approval",
      trigger: { type: "daily", ref: today },
      changes: lines.map((l) => ({ type: "update_session" as const, sessionId: l.id, fields: { durationMinutes: l.to } })),
      rationale: {
        summary: `Reduzir em ${pct}% a duração de ${lines.length} sessão(ões) (${lines.map((l) => `${l.from}→${l.to} min`).join(", ")}): ${reasonText} por ${params.subjective.consecutiveDays} dias seguidos.`,
        ruleIds: [`reduce-on-sustained-worsening@rules-v${input.ruleSetVersion}`],
        dataRefs,
        dataQuality: quality,
        caveats,
      },
    },
  ];
  return { outcome: "proposals", proposals, signals };
}

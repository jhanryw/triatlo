import type { Metadata } from "next";
import { MODALITIES } from "@triatlo/shared";
import { addDaysToDate, utcToLocalDate } from "@triatlo/domain";
import { ensureActivePlan, listPlanHistory, listWorkouts } from "@triatlo/data";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Field, Notice, firstParam, inputClass, primaryButton, secondaryButton } from "@/components/forms";
import { MODALITY_LABELS, SESSION_STATUS_LABELS } from "@/lib/labels";
import { requireSession } from "@/server/ctx";
import { addSessionAction, cancelSessionAction, planWeekAction, sessionStatusAction, undoAction } from "@/server/actions";
import { formatLocal, minutesLabel } from "@/server/format";

export const metadata: Metadata = { title: "Treinos" };
export const dynamic = "force-dynamic";

const PLANNABLE = ["swim", "bike_indoor", "run", "strength"] as const;

export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { ctx, timezone } = await requireSession();
  const plan = await ensureActivePlan(ctx);
  const [history, workouts] = await Promise.all([listPlanHistory(ctx, plan.planId, 8), listWorkouts(ctx, 15)]);
  const upcoming = [...plan.sessions].filter((s) => s.status !== "cancelled").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const today = timezone ? utcToLocalDate(new Date().toISOString(), timezone) : "";

  return (
    <>
      <PageHeader title="Treinos" subtitle="Calendário, registro das sessões e histórico do plano." />
      <Notice ok={firstParam(params.ok)} erro={firstParam(params.erro)} />

      <div className="grid gap-4">
        <Card title={`Plano (versão ${plan.version})`}>
          {upcoming.length === 0 ? (
            <EmptyState title="Nenhum treino planejado" description="Planeje a semana abaixo ou adicione uma sessão. Treinos não realizados não geram penalidade e não se acumulam." />
          ) : (
            <ul className="grid gap-3">
              {upcoming.map((s) => (
                <li key={s.id} className="rounded-xl bg-surface-muted p-3">
                  <p className="text-sm font-medium">{MODALITY_LABELS[s.modality]} · {s.durationMinutes} min</p>
                  <p className="text-xs text-muted">{timezone ? formatLocal(s.startsAt, timezone) : s.startsAt} · {SESSION_STATUS_LABELS[s.status].label}{s.objective ? ` · ${s.objective}` : ""}</p>
                  {s.status === "planned" ? (
                    <div className="mt-3 grid gap-2">
                      <form action={sessionStatusAction} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <input type="hidden" name="sessionId" value={s.id} />
                        <input name="duration" inputMode="numeric" placeholder="Duração real (min)" aria-label="Duração real em minutos" className={inputClass} />
                        <input name="distanceKm" inputMode="decimal" placeholder="Distância (km)" aria-label="Distância em km" className={inputClass} />
                        <input name="avgHr" inputMode="numeric" placeholder="FC média" aria-label="Frequência cardíaca média" className={inputClass} />
                        <input name="rpe" inputMode="decimal" placeholder="Esforço 1–10" aria-label="Esforço percebido de 1 a 10" className={inputClass} />
                        <button type="submit" name="status" value="completed" className={primaryButton}>Fiz tudo</button>
                        <button type="submit" name="status" value="partial" className={secondaryButton}>Fiz em parte</button>
                        <button type="submit" name="status" value="replaced" className={secondaryButton}>Troquei por outra</button>
                      </form>
                      <form action={cancelSessionAction}>
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button type="submit" className="text-sm text-muted underline">Cancelar sessão (sem penalidade)</button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Campos em branco ficam desconhecidos (nunca viram zero). O esforço percebido é uma nota sua, não uma medição.</p>
        </Card>

        <Card title="Planejar a semana">
          <form action={planWeekAction} className="grid gap-3">
            <p className="text-sm text-muted">Você define quantas sessões e quanto tempo; o sistema só escolhe os dias dentro das suas janelas de treino (Configurações) e não cria carga.</p>
            {PLANNABLE.map((m) => (
              <div key={m} className="grid grid-cols-[1fr_5rem_6rem] items-end gap-2">
                <span className="text-sm font-medium">{MODALITY_LABELS[m]}</span>
                <input name={`${m}_count`} inputMode="numeric" placeholder="vezes" aria-label={`${MODALITY_LABELS[m]}: vezes na semana`} className={inputClass} />
                <input name={`${m}_duration`} inputMode="numeric" placeholder="min" aria-label={`${MODALITY_LABELS[m]}: minutos por sessão`} className={inputClass} />
              </div>
            ))}
            <Field label="Semana começa em" htmlFor="weekStart" hint="Em branco = amanhã.">
              <input id="weekStart" name="weekStart" type="date" min={today || undefined} defaultValue={today ? addDaysToDate(today, 1) : undefined} className={inputClass} />
            </Field>
            <div><button type="submit" className={primaryButton}>Posicionar sessões</button></div>
          </form>
        </Card>

        <Card title="Adicionar sessão">
          <form action={addSessionAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Modalidade" htmlFor="modality">
              <select id="modality" name="modality" className={inputClass} defaultValue="run">
                {MODALITIES.map((m) => <option key={m} value={m}>{MODALITY_LABELS[m]}</option>)}
              </select>
            </Field>
            <Field label="Duração (min)" htmlFor="duration"><input id="duration" name="duration" inputMode="numeric" required className={inputClass} /></Field>
            <Field label="Data" htmlFor="date"><input id="date" name="date" type="date" required defaultValue={today || undefined} className={inputClass} /></Field>
            <Field label="Hora" htmlFor="time"><input id="time" name="time" type="time" required className={inputClass} /></Field>
            <Field label="Objetivo" htmlFor="objective"><input id="objective" name="objective" className={inputClass} placeholder="Opcional" /></Field>
            <div className="flex items-end"><button type="submit" className={primaryButton}>Adicionar</button></div>
          </form>
        </Card>

        <Card title="Treinos realizados">
          {workouts.length === 0 ? (
            <EmptyState title="Sem histórico" description="As sessões que você registrar, e as importadas do relógio, aparecem aqui." />
          ) : (
            <ul className="grid gap-2">
              {workouts.map((w) => (
                <li key={w.id as string} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                  <span className="font-medium">{MODALITY_LABELS[w.modality as keyof typeof MODALITY_LABELS]}</span>
                  <span className="text-muted"> · {timezone ? formatLocal(w.started_at as string, timezone) : (w.started_at as string)} · {minutesLabel(w.duration_minutes as number | null)}
                    {w.distance_meters !== null ? ` · ${((w.distance_meters as number) / 1000).toFixed(1)} km` : ""}
                    {w.avg_heart_rate_bpm !== null ? ` · ${w.avg_heart_rate_bpm} bpm` : ""}
                    {" · "}{w.source === "manual" ? "manual" : w.source === "file_import" ? "arquivo" : "relógio"}{w.completion === "partial" ? " · parcial" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Histórico do plano">
          <ul className="grid gap-2">
            {history.map((h) => (
              <li key={String(h.version)} className="flex items-start justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">v{String(h.version)}</span>
                  <span className="text-muted"> · {String(h.reason)} · {h.created_by_kind === "engine" ? "assistente" : h.created_by_kind === "user" ? "você" : "sistema"}</span>
                </span>
                {Number(h.version) < plan.version ? (
                  <form action={undoAction}>
                    <input type="hidden" name="planId" value={plan.planId} />
                    <input type="hidden" name="version" value={String(h.version)} />
                    <button type="submit" className="text-xs underline">Voltar a esta</button>
                  </form>
                ) : <span className="text-xs text-muted">atual</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Voltar cria uma nova versão; nada é apagado.</p>
        </Card>
      </div>
    </>
  );
}

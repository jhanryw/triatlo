import type { Metadata } from "next";
import Link from "next/link";
import { intakeSummary, utcToLocalDate } from "@triatlo/domain";
import { ensureActivePlan, listProposals, loadDayContexts } from "@triatlo/data";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { Field, Notice, ScoreSelect, firstParam, inputClass, primaryButton, secondaryButton } from "@/components/forms";
import { MODALITY_LABELS, SESSION_STATUS_LABELS, DATA_QUALITY_LABELS } from "@/lib/labels";
import { requireSession } from "@/server/ctx";
import { approveProposalAction, rejectProposalAction, saveCheckinAction } from "@/server/actions";
import { formatLocal, minutesLabel, orDash } from "@/server/format";

export const metadata: Metadata = { title: "Hoje" };
export const dynamic = "force-dynamic";

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { ctx, timezone } = await requireSession();
  const today = timezone ? utcToLocalDate(new Date().toISOString(), timezone) : null;
  const [proposals, plan, days] = await Promise.all([
    listProposals(ctx),
    ensureActivePlan(ctx),
    today ? loadDayContexts(ctx, today, today) : Promise.resolve([]),
  ]);
  const day = days[0];
  const todays = timezone ? plan.sessions.filter((s) => s.status !== "cancelled" && utcToLocalDate(s.startsAt, timezone) === today) : [];
  const intake = intakeSummary(day);

  return (
    <>
      <PageHeader title="Hoje" subtitle="Seu painel do dia: recuperação, treino, alimentação e o que precisa de você." />
      <Notice ok={firstParam(params.ok)} erro={firstParam(params.erro)} />

      <div className="grid gap-4">
        {!timezone ? (
          <Card title="Antes de começar">
            <p className="text-sm">Defina seu fuso horário para que o dia, os treinos e os lembretes usem o seu relógio.</p>
            <Link href="/settings" className={`${primaryButton} mt-3 inline-flex items-center`}>Abrir Configurações</Link>
          </Card>
        ) : null}

        <Card title="Pendências" aside={proposals.length ? <StatusPill tone="warn">{proposals.length}</StatusPill> : undefined}>
          {proposals.length === 0 ? (
            <EmptyState title="Nenhuma ação pendente" description="Quando os dados indicarem um ajuste, a proposta aparece aqui com a justificativa. Nada muda sem a sua aprovação, exceto o que você liberar." />
          ) : (
            <ul className="grid gap-3">
              {proposals.map((p) => (
                <li key={p.id} className="rounded-xl bg-surface-muted p-3">
                  <p className="text-sm font-medium">{p.rationale.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    {DATA_QUALITY_LABELS[p.rationale.dataQuality]} · {p.changes.length} alteração(ões) · regras: {p.rationale.ruleIds.join(", ") || "—"}
                  </p>
                  {p.rationale.caveats ? <p className="mt-1 text-xs text-muted">{p.rationale.caveats}</p> : null}
                  <p className="mt-1 text-xs text-muted">Não é diagnóstico nem recomendação médica. Você pode desfazer depois em Treinos.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={approveProposalAction}>
                      <input type="hidden" name="proposalId" value={p.id} />
                      <button type="submit" className={primaryButton}>Aprovar</button>
                    </form>
                    <form action={rejectProposalAction}>
                      <input type="hidden" name="proposalId" value={p.id} />
                      <button type="submit" className={secondaryButton}>Recusar</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recuperação" aside={day?.timezoneAssumed ? <StatusPill tone="warn">fuso assumido</StatusPill> : undefined}>
          {!day || (day.sleepMinutes === null && day.fatigueScore === null && day.restingHeartRate === null && day.energyScore === null && day.recoveryScore === null) ? (
            <EmptyState title="Sem dados de recuperação hoje" description="Faça o check-in abaixo ou importe dados do relógio em Configurações. Dado ausente nunca é tratado como zero." />
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <dt className="text-muted">Sono</dt><dd>{minutesLabel(day.sleepMinutes)}{day.sleepSource ? <span className="text-xs text-muted"> ({day.sleepSource === "external_connector" ? "relógio" : day.sleepSource === "file_import" ? "arquivo" : "manual"})</span> : null}</dd>
              <dt className="text-muted">FC de repouso</dt><dd>{orDash(day.restingHeartRate, " bpm")}</dd>
              <dt className="text-muted">Fadiga (1–5)</dt><dd>{orDash(day.fatigueScore)}</dd>
              <dt className="text-muted">Disposição</dt><dd>{orDash(day.energyScore)}</dd>
              <dt className="text-muted">Recuperação percebida</dt><dd>{orDash(day.recoveryScore)}</dd>
              <dt className="text-muted">Humor</dt><dd>{orDash(day.moodScore)}</dd>
            </dl>
          )}
        </Card>

        <Card title="Check-in do dia" aside={day?.checkinQuality ? <StatusPill tone="ok">{day.checkinQuality === "complete" ? "completo" : "parcial"}</StatusPill> : undefined}>
          <form action={saveCheckinAction} className="grid gap-3 sm:grid-cols-2">
            <ScoreSelect name="sleep" label="Qualidade do sono" low="muito ruim" high="muito boa" />
            <ScoreSelect name="fatigue" label="Fadiga" low="nenhuma" high="muita" />
            <ScoreSelect name="energy" label="Disposição" low="muito baixa" high="muito alta" />
            <ScoreSelect name="mood" label="Humor" low="muito ruim" high="muito bom" />
            <ScoreSelect name="recovery" label="Recuperação percebida" low="nada recuperado" high="totalmente recuperado" />
            <Field label="Observação" htmlFor="notes"><input id="notes" name="notes" className={inputClass} placeholder="Opcional" /></Field>
            <p className="text-xs text-muted sm:col-span-2">Responda só o que quiser: o que ficar em branco continua desconhecido. Salvar de novo no mesmo dia atualiza o check-in.</p>
            <div className="sm:col-span-2"><button type="submit" className={primaryButton}>Salvar check-in</button></div>
          </form>
        </Card>

        <Card title="Treino de hoje">
          {todays.length === 0 ? (
            <EmptyState title="Nenhum treino planejado para hoje" description="Planeje a semana em Treinos. Treinos não realizados não geram penalidade." />
          ) : (
            <ul className="grid gap-2">
              {todays.map((s) => (
                <li key={s.id} className="rounded-xl bg-surface-muted px-3 py-2">
                  <p className="text-sm font-medium">{MODALITY_LABELS[s.modality]} · {s.durationMinutes} min</p>
                  <p className="text-xs text-muted">{timezone ? formatLocal(s.startsAt, timezone) : ""} · {SESSION_STATUS_LABELS[s.status].label}</p>
                </li>
              ))}
            </ul>
          )}
          <Link href="/workouts" className="mt-3 inline-block text-sm font-medium text-accent">Ver semana e registrar</Link>
        </Card>

        <Card title="Alimentação">
          {intake.state === "not_recorded" ? (
            <EmptyState title="Nenhuma refeição registrada hoje" description="Não registrar não significa que você não comeu. O registro é opcional." />
          ) : (
            <p className="text-sm">
              {intake.mealsLogged} refeição(ões) registrada(s)
              {intake.energyKcal !== null ? <> · cerca de {Math.round(intake.energyKcal)} kcal <span className="text-muted">(estimativa{intake.state === "partial_estimates" ? ", só das refeições com estimativa" : ""})</span></> : <span className="text-muted"> · sem estimativa de energia</span>}
            </p>
          )}
          <Link href="/nutrition" className="mt-3 inline-block text-sm font-medium text-accent">Registrar refeição</Link>
        </Card>
      </div>
    </>
  );
}

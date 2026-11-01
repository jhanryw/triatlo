import type { Metadata } from "next";
import { addDaysToDate, utcToLocalDate } from "@triatlo/domain";
import { getApprovedRuleSet, getPreferences, listAudit, listProposals, loadDayContexts, readAiConfig } from "@triatlo/data";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { Notice, firstParam, primaryButton } from "@/components/forms";
import { DATA_QUALITY_LABELS } from "@/lib/labels";
import { requireSession } from "@/server/ctx";
import { runAnalysisNowAction } from "@/server/actions";
import { formatLocal } from "@/server/format";

export const metadata: Metadata = { title: "Assistente" };
export const dynamic = "force-dynamic";

const ACTOR = { user: "você", engine: "assistente", system: "sistema" } as const;
const PROPOSAL_STATUS: Record<string, string> = { proposed: "aguardando você", applied: "aplicada", rejected: "recusada", expired: "expirada", superseded: "substituída" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { ctx, timezone } = await requireSession();
  const [rules, prefs, audit, proposals] = await Promise.all([getApprovedRuleSet(ctx), getPreferences(ctx), listAudit(ctx, 15), listProposals(ctx, ["proposed", "applied", "rejected", "expired", "superseded"])]);
  const today = timezone ? utcToLocalDate(new Date().toISOString(), timezone) : null;
  const days = today ? await loadDayContexts(ctx, addDaysToDate(today, -13), today) : [];
  const have = (pick: (d: (typeof days)[number]) => unknown) => days.filter((d) => pick(d) !== null).length;
  const aiConfigured = readAiConfig(process.env) !== null;

  return (
    <>
      <PageHeader title="Assistente" subtitle="O que o sistema sabe, o que ele decidiu e por quê. Sem diagnóstico médico." />
      <Notice ok={firstParam(query.ok)} erro={firstParam(query.erro)} />
      <div className="grid gap-4">
        <Card title="Estado" aside={<StatusPill tone={rules ? "ok" : "warn"}>{rules ? `regras v${rules.version} aprovadas` : "regras não aprovadas"}</StatusPill>}>
          <ul className="grid gap-1 text-sm">
            <li>Ajustes automáticos: {prefs.autoApplyEnabled ? "só reduções pequenas dentro dos limites aprovados" : "desligados (toda mudança pede sua aprovação)"}.</li>
            <li>Progressão de carga: nunca automática.</li>
            <li>Fotos de refeição por IA: {aiConfigured ? (prefs.aiProcessingConsentAt ? "ativas (com seu consentimento)" : "disponíveis, mas sem seu consentimento") : "provedor não configurado"}.</li>
          </ul>
          <form action={runAnalysisNowAction} className="mt-3">
            <button type="submit" className={primaryButton}>Analisar agora</button>
          </form>
          <p className="mt-2 text-xs text-muted">A análise automática também roda sozinha uma vez por dia, no seu horário local.</p>
        </Card>

        <Card title="Dados usados (últimos 14 dias)">
          {days.length === 0 ? (
            <EmptyState title="Sem dados ainda" description="Sem dados o assistente não propõe nada: ausência não é tratada como “tudo bem” nem como “ruim”." />
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Dias com check-in</dt><dd>{have((d) => d.checkinQuality)}</dd>
              <dt className="text-muted">Dias com sono</dt><dd>{have((d) => d.sleepMinutes)}</dd>
              <dt className="text-muted">Dias com FC de repouso</dt><dd>{have((d) => d.restingHeartRate)}</dd>
              <dt className="text-muted">Dias com treino registrado</dt><dd>{have((d) => d.workoutCount)}</dd>
              <dt className="text-muted">Dias com refeições registradas</dt><dd>{days.filter((d) => d.intakeRecorded).length}</dd>
            </dl>
          )}
        </Card>

        <Card title="Propostas">
          {proposals.length === 0 ? <EmptyState title="Nenhuma proposta" /> : (
            <ul className="grid gap-2">
              {proposals.slice(0, 10).map((p) => (
                <li key={p.id} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                  <p className="font-medium">{p.rationale.summary}</p>
                  <p className="text-xs text-muted">{PROPOSAL_STATUS[p.status] ?? p.status} · {DATA_QUALITY_LABELS[p.rationale.dataQuality]} · {timezone ? formatLocal(p.createdAt, timezone) : p.createdAt}</p>
                  {p.rationale.caveats ? <p className="text-xs text-muted">{p.rationale.caveats}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Histórico de decisões">
          {audit.length === 0 ? <EmptyState title="Nenhuma decisão registrada" /> : (
            <ul className="grid gap-2">
              {audit.map((a) => (
                <li key={a.id as string} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                  <p>{a.summary as string}</p>
                  <p className="text-xs text-muted">{ACTOR[a.actor_kind as keyof typeof ACTOR]} · {timezone ? formatLocal(a.occurred_at as string, timezone) : (a.occurred_at as string)}{(a.rule_ids as string[]).length ? ` · ${(a.rule_ids as string[]).join(", ")}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

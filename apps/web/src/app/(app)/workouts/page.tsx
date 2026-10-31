import type { Metadata } from "next";
import { MODALITIES, SESSION_STATUSES } from "@triatlo/shared";
import { Card, DemoCard, EmptyState, PageHeader } from "@/components/ui";
import { MODALITY_LABELS, SESSION_STATUS_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Treinos" };

export default function WorkoutsPage() {
  return (
    <>
      <PageHeader title="Treinos" subtitle="Calendário, sessões e histórico." />

      <div className="grid gap-4">
        <Card title="Semana">
          <EmptyState
            title="Nenhum treino planejado"
            description="Sem plano ainda. Treinos não realizados não geram penalidade e não se acumulam."
          />
        </Card>

        <Card title="Estados de uma sessão">
          <ul className="grid gap-2 sm:grid-cols-2">
            {SESSION_STATUSES.map((status) => (
              <li key={status} className="rounded-xl bg-surface-muted px-3 py-2">
                <p className="text-sm font-medium">{SESSION_STATUS_LABELS[status].label}</p>
                <p className="text-xs text-muted">{SESSION_STATUS_LABELS[status].description}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Modalidades">
          <ul className="flex flex-wrap gap-2">
            {MODALITIES.map((modality) => (
              <li key={modality} className="rounded-full bg-surface-muted px-3 py-1 text-sm">
                {MODALITY_LABELS[modality]}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Histórico">
          <EmptyState title="Sem histórico" description="As sessões realizadas aparecerão aqui." />
        </Card>

        <DemoCard title="Exemplo: cartão de sessão">
          <div className="rounded-xl bg-surface-muted px-3 py-3">
            <p className="text-sm font-medium">Modalidade · duração · objetivo</p>
            <p className="mt-1 text-xs text-muted">
              Aqui aparecerão intensidade, instruções, esforço percebido e estado. Os valores virão do seu plano, nunca de
              números inventados.
            </p>
          </div>
        </DemoCard>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Evolução" };

export default function ProgressPage() {
  return (
    <>
      <PageHeader title="Evolução" subtitle="Indicadores e tendências ao longo do tempo." />

      <div className="grid gap-4">
        <Card title="Treino">
          <EmptyState title="Sem dados de treino" description="Os gráficos aparecem quando houver sessões registradas." />
        </Card>
        <Card title="Sono e recuperação">
          <EmptyState
            title="Sem dados de sono"
            description="Lacunas nos dados aparecem como lacunas — não como zero. Uma métrica isolada nunca é tratada como diagnóstico."
          />
        </Card>
        <Card title="Alimentação">
          <EmptyState
            title="Sem registros alimentares"
            description="Tendências só consideram dias com registro. Ausência de registro não significa ausência de refeição."
          />
        </Card>
      </div>
    </>
  );
}

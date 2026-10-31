import type { Metadata } from "next";
import { Card, DemoCard, DisabledButton, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Hoje" };

export default function TodayPage() {
  return (
    <>
      <PageHeader title="Hoje" subtitle="Seu painel do dia: recuperação, treino, alimentação e o que precisa de você." />

      <div className="grid gap-4">
        <Card title="Recuperação">
          <EmptyState
            title="Sem dados de recuperação ainda"
            description="Quando você fizer um check-in ou houver dados de sono, eles aparecem aqui. Dado ausente nunca é tratado como zero."
          />
        </Card>

        <Card title="Treino de hoje">
          <EmptyState
            title="Nenhum treino planejado"
            description="O calendário de treinos chega nas próximas etapas. Nada é criado automaticamente."
          />
        </Card>

        <Card title="Alimentação">
          <EmptyState
            title="Nenhuma refeição registrada"
            description="Não registrar não significa que você não comeu. O registro é opcional."
          />
        </Card>

        <Card title="Pendências">
          <EmptyState
            title="Nenhuma ação pendente"
            description="Propostas de ajuste que precisem da sua aprovação aparecerão aqui, com a justificativa e os dados usados."
          />
        </Card>

        <DemoCard title="Exemplo: proposta de ajuste">
          <p className="text-sm">
            Assim será um pedido de aprovação: o que muda, por quê, quais dados foram usados e como desfazer.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <DisabledButton reason="Demonstração: não há proposta real">Aprovar</DisabledButton>
            <DisabledButton reason="Demonstração: não há proposta real">Recusar</DisabledButton>
          </div>
        </DemoCard>
      </div>
    </>
  );
}

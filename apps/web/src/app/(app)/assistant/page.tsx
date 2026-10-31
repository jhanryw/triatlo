import type { Metadata } from "next";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";

export const metadata: Metadata = { title: "Assistente" };

export default function AssistantPage() {
  return (
    <>
      <PageHeader title="Assistente" subtitle="Perguntas e sugestões com o seu contexto." />

      <div className="grid gap-4">
        <Card title="Estado" aside={<StatusPill tone="neutral">IA desativada</StatusPill>}>
          <EmptyState
            title="O assistente ainda não está ativo"
            description="Nenhum dado seu é enviado a provedores de IA. Antes de ativar, você verá exatamente quais dados serão processados e poderá consentir ou recusar."
          />
        </Card>

        <Card title="Conversa">
          <label htmlFor="assistant-input" className="sr-only">
            Mensagem para o assistente
          </label>
          <textarea
            id="assistant-input"
            disabled
            rows={3}
            placeholder="Indisponível: IA desativada"
            className="w-full resize-none rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm"
          />
        </Card>
      </div>
    </>
  );
}

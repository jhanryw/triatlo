import type { Metadata } from "next";
import { Card, DisabledButton, PageHeader, StatusPill } from "@/components/ui";
import { PushSetup } from "@/components/PushSetup";
import { readPublicConfig } from "@/lib/env";
import { readSupabaseEnv } from "@/lib/supabase/env";
import pkg from "../../../../package.json";

export const metadata: Metadata = { title: "Configurações" };

// Reads runtime configuration: must be rendered per request, not at build time.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const supabaseConfigured = readSupabaseEnv() !== null;

  return (
    <>
      <PageHeader title="Configurações" subtitle="Integrações, notificações, privacidade e IA." />

      <div className="grid gap-4">
        <Card title="Notificações">
          <PushSetup config={readPublicConfig()} />
        </Card>

        <Card title="Integrações" aside={<StatusPill tone="neutral">Não configurado</StatusPill>}>
          <p className="text-sm font-medium">Amazfit Active 2</p>
          <p className="mt-1 text-sm text-muted">
            Nenhuma integração ativa. Não há API pública comprovada para ler esses dados: o caminho será definido na
            Entrega 7, a partir de fontes oficiais e autorizadas. A importação manual será a primeira alternativa.
          </p>
        </Card>

        <Card title="IA e privacidade" aside={<StatusPill tone="neutral">IA desativada</StatusPill>}>
          <p className="text-sm text-muted">
            Nenhum dado é enviado a provedores de IA. Antes de qualquer ativação, esta seção mostrará quais dados serão
            processados e pedirá seu consentimento.
          </p>
        </Card>

        <Card title="Seus dados">
          <p className="mb-3 text-sm text-muted">Exportação e exclusão dos seus registros ficam disponíveis após a Entrega 2.</p>
          <div className="flex flex-wrap gap-2">
            <DisabledButton reason="Disponível após a Entrega 2">Exportar dados</DisabledButton>
            <DisabledButton reason="Disponível após a Entrega 2">Excluir registros</DisabledButton>
          </div>
        </Card>

        <Card title="Sistema">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Versão</dt>
            <dd>{pkg.version} (Entrega 1 — fundação)</dd>
            <dt className="text-muted">Banco de dados</dt>
            <dd>
              {supabaseConfigured ? (
                <StatusPill tone="ok">Configurado</StatusPill>
              ) : (
                <StatusPill tone="warn">Não configurado — aguardando infraestrutura</StatusPill>
              )}
            </dd>
            <dt className="text-muted">Autenticação</dt>
            <dd>
              <StatusPill tone="neutral">Entrega 2</StatusPill>
            </dd>
          </dl>
        </Card>
      </div>
    </>
  );
}

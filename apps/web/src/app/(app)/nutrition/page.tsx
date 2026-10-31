import type { Metadata } from "next";
import { Card, DisabledButton, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Alimentação" };

export default function NutritionPage() {
  return (
    <>
      <PageHeader title="Alimentação" subtitle="Planejamento flexível, registros e fotos de refeições." />

      <div className="grid gap-4">
        <Card title="Plano">
          <EmptyState
            title="Nenhum plano alimentar"
            description="Opções de refeições e lanches, e a alimentação ao redor dos treinos, serão configuradas na Entrega 5."
          />
        </Card>

        <Card title="Registros">
          <EmptyState
            title="Nenhuma refeição registrada"
            description="Estimativas de porção, energia e macronutrientes serão sempre apresentadas como incertas e você poderá corrigi-las."
          />
          <div className="mt-3">
            <DisabledButton reason="Disponível na Entrega 5">Registrar refeição</DisabledButton>
          </div>
        </Card>

        <Card title="Fotos">
          <EmptyState
            title="Sem fotos"
            description="As fotos ficarão em armazenamento privado. Nenhuma foto é enviada a uma IA sem a sua configuração e consentimento."
          />
        </Card>

        <Card title="Preparação e compras">
          <EmptyState title="Lista vazia" description="Uma lista simples para organizar as refeições do dia seguinte." />
        </Card>
      </div>
    </>
  );
}

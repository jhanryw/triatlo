import type { Metadata } from "next";
import Link from "next/link";
import { MEAL_TYPES } from "@triatlo/shared";
import { utcToLocalDate } from "@triatlo/domain";
import { ensureActivePlan, getPreferences } from "@triatlo/data";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { Field, Notice, firstParam, inputClass, primaryButton } from "@/components/forms";
import { MEAL_TYPE_LABELS, MODALITY_LABELS } from "@/lib/labels";
import { requireSession } from "@/server/ctx";
import { uploadMealAction } from "@/server/actions";
import { daysAgoIso, formatLocal } from "@/server/format";

export const metadata: Metadata = { title: "Alimentação" };
export const dynamic = "force-dynamic";

interface MealRow { id: string; eaten_at: string; meal_type: (typeof MEAL_TYPES)[number]; notes: string | null; photo_path: string | null }
interface EstimateRow { meal_id: string; meal_item_id: string | null; energy_kcal: number | null; protein_g: number | null; carbohydrate_g: number | null; fat_g: number | null; method: string; confidence: string | null }

export default async function NutritionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { ctx, timezone } = await requireSession();
  const [prefs, plan] = await Promise.all([getPreferences(ctx), ensureActivePlan(ctx)]);
  const since = daysAgoIso(7);
  const meals = ((await ctx.db.from("meals").select("id, eaten_at, meal_type, notes, photo_path").eq("user_id", ctx.userId).gte("eaten_at", since).order("eaten_at", { ascending: false })).data ?? []) as MealRow[];
  const estimates = meals.length
    ? (((await ctx.db.from("nutrition_estimates").select("meal_id, meal_item_id, energy_kcal, protein_g, carbohydrate_g, fat_g, method, confidence").in("meal_id", meals.map((m) => m.id)).is("meal_item_id", null)).data ?? []) as EstimateRow[])
    : [];
  const byMeal = new Map(estimates.map((e) => [e.meal_id, e]));
  const today = timezone ? utcToLocalDate(new Date().toISOString(), timezone) : null;
  const trainingToday = timezone ? plan.sessions.filter((s) => s.status !== "cancelled" && utcToLocalDate(s.startsAt, timezone) === today) : [];
  const mealsToday = timezone ? meals.filter((m) => utcToLocalDate(m.eaten_at, timezone) === today) : [];

  type Item = { at: string; label: string; kind: "training" | "meal" };
  const timeline: Item[] = [
    ...trainingToday.map((s) => ({ at: s.startsAt, label: `${MODALITY_LABELS[s.modality]} · ${s.durationMinutes} min`, kind: "training" as const })),
    ...mealsToday.map((m) => ({ at: m.eaten_at, label: MEAL_TYPE_LABELS[m.meal_type], kind: "meal" as const })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <>
      <PageHeader title="Alimentação" subtitle="Registro de refeições, fotos com estimativa e contexto dos treinos." />
      <Notice ok={firstParam(params.ok)} erro={firstParam(params.erro)} />

      <div className="grid gap-4">
        <Card title="Registrar refeição">
          <form action={uploadMealAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo" htmlFor="mealType">
              <select id="mealType" name="mealType" className={inputClass} defaultValue="lunch">
                {MEAL_TYPES.map((t) => <option key={t} value={t}>{MEAL_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Foto (opcional)" htmlFor="photo">
              <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Observação" htmlFor="notes"><input id="notes" name="notes" className={inputClass} placeholder="Opcional" /></Field>
            </div>
            <p className="text-xs text-muted sm:col-span-2">
              {prefs.aiProcessingConsentAt
                ? "Com foto, uma IA estima os itens e os valores. São estimativas: você revisa e corrige antes de salvar."
                : "A análise por IA está desligada (sem consentimento). Você ainda pode registrar a refeição e preencher os itens manualmente."}
              {" "}A foto fica em armazenamento privado.
            </p>
            <div className="sm:col-span-2"><button type="submit" className={primaryButton}>Continuar</button></div>
          </form>
        </Card>

        <Card title="Hoje: treinos e refeições">
          {!timezone ? (
            <EmptyState title="Defina seu fuso horário" description="Sem fuso, não dá para saber o que é “hoje”." />
          ) : timeline.length === 0 ? (
            <EmptyState title="Nada registrado nem planejado hoje" description="Não registrar não significa que você não comeu." />
          ) : (
            <ol className="grid gap-2">
              {timeline.map((t, i) => (
                <li key={`${t.at}-${i}`} className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2 text-sm">
                  <StatusPill tone={t.kind === "training" ? "ok" : "neutral"}>{t.kind === "training" ? "treino" : "refeição"}</StatusPill>
                  <span>{t.label}</span>
                  <span className="ml-auto text-xs text-muted">{formatLocal(t.at, timezone)}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-muted">Metas de calorias e macros não são inventadas aqui: só aparecem quando você ou seu profissional as definirem.</p>
        </Card>

        <Card title="Últimos 7 dias">
          {meals.length === 0 ? (
            <EmptyState title="Nenhuma refeição registrada" description="As estimativas aparecem sempre como estimativas, com a confiança." />
          ) : (
            <ul className="grid gap-2">
              {meals.map((m) => {
                const e = byMeal.get(m.id);
                return (
                  <li key={m.id}>
                    <Link href={`/nutrition/review/${m.id}`} className="block rounded-xl bg-surface-muted px-3 py-2 text-sm">
                      <span className="font-medium">{MEAL_TYPE_LABELS[m.meal_type]}</span>
                      <span className="text-muted"> · {timezone ? formatLocal(m.eaten_at, timezone) : m.eaten_at}</span>
                      <span className="block text-xs text-muted">
                        {e ? `${e.energy_kcal !== null ? `≈ ${Math.round(e.energy_kcal)} kcal` : "sem kcal"} · estimativa ${e.method === "ai" ? "por IA" : "revisada por você"}${e.confidence ? ` · confiança ${e.confidence === "high" ? "alta" : e.confidence === "medium" ? "média" : "baixa"}` : ""}` : "sem estimativa — toque para revisar"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

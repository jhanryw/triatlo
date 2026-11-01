import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MealAnalysisResultSchema } from "@triatlo/shared";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { Notice, firstParam, inputClass, primaryButton } from "@/components/forms";
import { requireSession } from "@/server/ctx";
import { saveReviewedMealAction } from "@/server/actions";

export const metadata: Metadata = { title: "Revisar refeição" };
export const dynamic = "force-dynamic";

interface Row { name: string; quantity: number | null; unit: string | null; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; proposed: boolean }
const BLANK: Row = { name: "", quantity: null, unit: null, kcal: null, protein: null, carbs: null, fat: null, proposed: false };

const v = (n: number | null): string => (n === null ? "" : String(n));

export default async function ReviewMealPage({ params, searchParams }: { params: Promise<{ mealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { mealId } = await params;
  const query = await searchParams;
  const { ctx } = await requireSession();
  if (!/^[0-9a-f-]{36}$/i.test(mealId)) notFound();

  const meal = (await ctx.db.from("meals").select("id, eaten_at, meal_type, notes, photo_path").eq("id", mealId).eq("user_id", ctx.userId).maybeSingle()).data;
  if (!meal) notFound();
  const [items, estimates, analyses] = await Promise.all([
    ctx.db.from("meal_items").select("id, name, quantity, unit").eq("meal_id", mealId).order("created_at", { ascending: true }),
    ctx.db.from("nutrition_estimates").select("meal_item_id, energy_kcal, protein_g, carbohydrate_g, fat_g, method, model, confidence").eq("meal_id", mealId),
    ctx.db.from("meal_analyses").select("status, confidence, result, model, error").eq("meal_id", mealId).order("created_at", { ascending: false }).limit(1),
  ]);
  const analysis = analyses.data?.[0];
  const parsed = analysis?.status === "succeeded" ? MealAnalysisResultSchema.safeParse(analysis.result) : null;

  let rows: Row[] = [];
  let origin: "saved" | "ai" | "empty" = "empty";
  if ((items.data ?? []).length > 0) {
    origin = "saved";
    const byItem = new Map((estimates.data ?? []).filter((e) => e.meal_item_id).map((e) => [e.meal_item_id as string, e]));
    rows = (items.data ?? []).map((i) => {
      const e = byItem.get(i.id as string);
      return { name: i.name as string, quantity: i.quantity as number | null, unit: i.unit as string | null, kcal: e?.energy_kcal ?? null, protein: e?.protein_g ?? null, carbs: e?.carbohydrate_g ?? null, fat: e?.fat_g ?? null, proposed: false };
    });
  } else if (parsed?.success && parsed.data.isFood) {
    origin = "ai";
    rows = parsed.data.items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, kcal: i.energyKcal, protein: i.proteinG, carbs: i.carbohydrateG, fat: i.fatG, proposed: true }));
  }
  const form = [...rows, BLANK, BLANK, BLANK];

  let photoUrl: string | null = null;
  if (meal.photo_path) photoUrl = (await ctx.db.storage.from("meal-photos").createSignedUrl(meal.photo_path as string, 600)).data?.signedUrl ?? null;
  const overall = meal.id && (estimates.data ?? []).find((e) => e.meal_item_id === null);

  return (
    <>
      <PageHeader title="Revisar refeição" subtitle="Tudo aqui é estimativa. Corrija o que estiver errado antes de salvar." />
      <Notice ok={firstParam(query.ok)} erro={firstParam(query.erro)} />
      <div className="grid gap-4">
        {photoUrl ? (
          <Card title="Foto">
            {/* Signed URL, short-lived, private bucket: next/image optimisation would proxy it needlessly. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="Foto da refeição" className="max-h-72 w-full rounded-xl object-cover" />
          </Card>
        ) : null}

        <Card title="Análise" aside={analysis ? <StatusPill tone={analysis.status === "succeeded" ? "ok" : "warn"}>{analysis.status === "succeeded" ? `IA · confiança ${analysis.confidence === "high" ? "alta" : analysis.confidence === "medium" ? "média" : "baixa"}` : "IA indisponível"}</StatusPill> : <StatusPill tone="neutral">manual</StatusPill>}>
          {origin === "ai" && parsed?.success ? (
            <p className="text-sm text-muted">{parsed.data.uncertaintyNotes ?? "A IA não registrou incertezas, mas porções e ingredientes ocultos sempre variam."}</p>
          ) : parsed?.success && !parsed.data.isFood ? (
            <EmptyState title="A IA não reconheceu comida na foto" description="Preencha os itens manualmente, se quiser." />
          ) : origin === "empty" ? (
            <p className="text-sm text-muted">{analysis?.status === "failed" ? "A análise falhou; preencha manualmente." : "Sem análise automática: preencha os itens manualmente."}</p>
          ) : (
            <p className="text-sm text-muted">Itens salvos anteriormente. Você pode ajustá-los.</p>
          )}
          {overall ? <p className="mt-2 text-xs text-muted">Total salvo: {overall.energy_kcal !== null ? `≈ ${Math.round(Number(overall.energy_kcal))} kcal` : "sem kcal"} (estimativa).</p> : null}
        </Card>

        <Card title="Itens">
          <form action={saveReviewedMealAction} className="grid gap-4">
            <input type="hidden" name="mealId" value={mealId} />
            <input type="hidden" name="itemCount" value={form.length} />
            <input type="hidden" name="model" value={analysis?.model ?? ""} />
            <input type="hidden" name="confidence" value={analysis?.status === "succeeded" ? String(analysis.confidence ?? "") : ""} />
            {form.map((r, i) => (
              <fieldset key={i} className="grid grid-cols-2 gap-2 rounded-xl bg-surface-muted p-3 sm:grid-cols-4">
                <legend className="sr-only">Item {i + 1}</legend>
                {r.proposed ? (
                  <>
                    <input type="hidden" name={`orig_name_${i}`} value={r.name} />
                    <input type="hidden" name={`orig_quantity_${i}`} value={v(r.quantity)} />
                    <input type="hidden" name={`orig_unit_${i}`} value={r.unit ?? ""} />
                    <input type="hidden" name={`orig_kcal_${i}`} value={v(r.kcal)} />
                    <input type="hidden" name={`orig_protein_${i}`} value={v(r.protein)} />
                    <input type="hidden" name={`orig_carbs_${i}`} value={v(r.carbs)} />
                    <input type="hidden" name={`orig_fat_${i}`} value={v(r.fat)} />
                  </>
                ) : null}
                <input name={`name_${i}`} defaultValue={r.name} placeholder="Alimento" aria-label={`Item ${i + 1}: alimento`} className={`${inputClass} col-span-2 sm:col-span-4`} />
                <input name={`quantity_${i}`} defaultValue={v(r.quantity)} inputMode="decimal" placeholder="Qtd" aria-label={`Item ${i + 1}: quantidade`} className={inputClass} />
                <input name={`unit_${i}`} defaultValue={r.unit ?? ""} placeholder="Unidade (g, un…)" aria-label={`Item ${i + 1}: unidade`} className={inputClass} />
                <input name={`kcal_${i}`} defaultValue={v(r.kcal)} inputMode="decimal" placeholder="kcal" aria-label={`Item ${i + 1}: kcal estimadas`} className={inputClass} />
                <input name={`protein_${i}`} defaultValue={v(r.protein)} inputMode="decimal" placeholder="Prot. g" aria-label={`Item ${i + 1}: proteína em gramas`} className={inputClass} />
                <input name={`carbs_${i}`} defaultValue={v(r.carbs)} inputMode="decimal" placeholder="Carb. g" aria-label={`Item ${i + 1}: carboidrato em gramas`} className={inputClass} />
                <input name={`fat_${i}`} defaultValue={v(r.fat)} inputMode="decimal" placeholder="Gord. g" aria-label={`Item ${i + 1}: gordura em gramas`} className={inputClass} />
                {r.name ? (
                  <label className="col-span-2 flex items-center gap-2 text-xs text-muted"><input type="checkbox" name={`remove_${i}`} /> Remover este item</label>
                ) : null}
              </fieldset>
            ))}
            <p className="text-xs text-muted">Campo vazio = não sei (não é zero). O total da refeição só soma um nutriente quando todos os itens têm esse valor.</p>
            <div><button type="submit" className={primaryButton}>Salvar revisão</button></div>
          </form>
        </Card>
      </div>
    </>
  );
}

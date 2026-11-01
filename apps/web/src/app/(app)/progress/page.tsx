import type { Metadata } from "next";
import { addDaysToDate, indexByDay, intakeSummary, median, utcToLocalDate } from "@triatlo/domain";
import { loadDayContexts } from "@triatlo/data";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/server/ctx";
import { minutesLabel } from "@/server/format";

export const metadata: Metadata = { title: "Evolução" };
export const dynamic = "force-dynamic";

const DAYS = 14;

/** One bar per day. A day without a record is a visible GAP (dashed), never a zero-height bar. */
function Bars({ label, values, max, format }: { label: string; values: Array<number | null>; max: number; format: (v: number) => string }) {
  const any = values.some((v) => v !== null);
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium">{label}</figcaption>
      {any ? null : <p className="text-xs text-muted">Sem dados neste período.</p>}
      <ol className={`flex items-end gap-1 ${any ? "h-20" : "h-3"}`} aria-label={label}>
        {values.map((v, i) => (
          <li key={i} className="flex h-full flex-1 items-end" title={v === null ? "sem dado" : format(v)}>
            {v === null ? (
              <span className="h-px w-full border-t border-dashed border-muted/50" aria-label="sem dado" />
            ) : (
              <span className="w-full rounded-t bg-accent" style={{ height: `${Math.max(4, Math.round((v / max) * 100))}%` }} aria-label={format(v)} />
            )}
          </li>
        ))}
      </ol>
    </figure>
  );
}

export default async function ProgressPage() {
  const { ctx, timezone } = await requireSession();
  if (!timezone) {
    return (
      <>
        <PageHeader title="Evolução" subtitle="Indicadores e tendências ao longo do tempo." />
        <Card title="Fuso horário"><EmptyState title="Defina seu fuso horário em Configurações" description="Sem ele não dá para agrupar os dados por dia." /></Card>
      </>
    );
  }
  const today = utcToLocalDate(new Date().toISOString(), timezone);
  const from = addDaysToDate(today, -(DAYS - 1));
  const days = await loadDayContexts(ctx, from, today);
  const byDay = indexByDay(days);
  const dates = Array.from({ length: DAYS }, (_, i) => addDaysToDate(from, i));
  const series = (pick: (d: NonNullable<ReturnType<typeof byDay.get>>) => number | null) => dates.map((d) => { const row = byDay.get(d); return row ? pick(row) : null; });

  const sleep = series((d) => d.sleepMinutes);
  const fatigue = series((d) => d.fatigueScore);
  const energy = series((d) => d.energyScore);
  const rhr = series((d) => d.restingHeartRate);
  const workoutMin = series((d) => d.workoutMinutes);
  const kcal = dates.map((d) => { const s = intakeSummary(byDay.get(d)); return s.energyKcal; });
  const known = (arr: Array<number | null>) => arr.filter((v): v is number => v !== null);
  const medianOf = (arr: Array<number | null>) => median(known(arr));

  return (
    <>
      <PageHeader title="Evolução" subtitle={`Últimos ${DAYS} dias. Lacunas são lacunas, não zeros; nenhuma métrica isolada é diagnóstico.`} />
      <div className="grid gap-4">
        <Card title="Sono e recuperação">
          {known(sleep).length + known(fatigue).length + known(rhr).length === 0 ? (
            <EmptyState title="Sem dados de sono ou recuperação" description="Faça check-ins ou importe dados do relógio em Configurações." />
          ) : (
            <div className="grid gap-5">
              <Bars label={`Sono (mediana ${minutesLabel(medianOf(sleep))})`} values={sleep} max={Math.max(600, ...known(sleep))} format={minutesLabel} />
              <Bars label="Fadiga percebida (1–5, maior = mais cansado)" values={fatigue} max={5} format={(v) => String(v)} />
              <Bars label="Disposição (1–5)" values={energy} max={5} format={(v) => String(v)} />
              <Bars label="FC de repouso (bpm)" values={rhr} max={Math.max(1, ...known(rhr))} format={(v) => `${v} bpm`} />
            </div>
          )}
        </Card>
        <Card title="Treino">
          {known(workoutMin).length === 0 ? (
            <EmptyState title="Sem treinos registrados" description="Os gráficos aparecem quando houver sessões registradas." />
          ) : (
            <Bars label={`Minutos treinados (${known(workoutMin).length} dia(s) com registro)`} values={workoutMin} max={Math.max(1, ...known(workoutMin))} format={(v) => `${v} min`} />
          )}
        </Card>
        <Card title="Alimentação (estimativa)">
          {known(kcal).length === 0 ? (
            <EmptyState title="Sem estimativas de energia" description="Tendências só consideram dias com registro. Ausência de registro não significa ausência de refeição." />
          ) : (
            <Bars label={`Energia estimada por dia (${known(kcal).length} dia(s) com estimativa)`} values={kcal} max={Math.max(1, ...known(kcal))} format={(v) => `≈ ${Math.round(v)} kcal`} />
          )}
        </Card>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { MODALITIES, type Modality } from "@triatlo/shared";
import { MODALITY_LABELS } from "@/lib/labels";
import { inputClass, primaryButton, secondaryButton } from "./forms";

interface InventoryRow { sourceName: string; type: string; count: number; first: string; last: string }
interface Workout { sourceActivityType: string | null; modality: Modality | null; sourceName: string | null; startedAt: string }
interface Analysis {
  format: "apple_health" | "gpx" | "tcx";
  fileSha256: string;
  bytes: number;
  inventory?: InventoryRow[];
  staged: { records?: unknown[]; workouts: Workout[] };
}
interface Report { received: number; inserted: number; skipped: number; warnings: string[] }

const TYPE_LABELS: Record<string, string> = {
  HKQuantityTypeIdentifierRestingHeartRate: "FC de repouso",
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "Variabilidade da FC (HRV)",
  HKCategoryTypeIdentifierSleepAnalysis: "Sono",
};
const looksLikeAmazfit = (name: string): boolean => /zepp|amazfit/i.test(name);

/**
 * Imports REAL exported files (Apple Health export.xml, GPX, TCX). Step 1 only reads the file and shows what it contains;
 * nothing is stored until the user chooses sources and confirms. Unknown activity types need the user's own modality choice.
 */
export function ImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, Modality>>({});
  const [report, setReport] = useState<Report | null>(null);

  async function analyze() {
    if (!file) return;
    setBusy(true); setError(null); setAnalysis(null); setReport(null);
    try {
      const res = await fetch("/api/import/analyze", { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } });
      const body = (await res.json()) as Analysis & { message?: string; error?: string };
      if (!res.ok) { setError(body.message ?? "Não foi possível ler o arquivo."); return; }
      setAnalysis(body);
      setSources(new Set((body.inventory ?? []).map((r) => r.sourceName).filter(looksLikeAmazfit)));
      setChoices({});
    } catch {
      setError("Falha ao enviar o arquivo. Confira a conexão e tente de novo.");
    } finally { setBusy(false); }
  }

  const unknownTypes = analysis ? [...new Set(analysis.staged.workouts
    .filter((w) => w.modality === null && (analysis.format !== "apple_health" || (w.sourceName !== null && sources.has(w.sourceName))))
    .map((w) => w.sourceActivityType ?? "(sem tipo)"))] : [];

  async function commit() {
    if (!analysis || !file) return;
    setBusy(true); setError(null);
    try {
      const common = { format: analysis.format, fileName: file.name.slice(0, 200), fileSha256: analysis.fileSha256 };
      const payload = analysis.format === "apple_health"
        ? { ...common, sources: [...sources], modalityChoices: choices, staged: analysis.staged }
        : { ...common, modalityByIndex: Object.fromEntries(analysis.staged.workouts.flatMap((w, i) => { const c = choices[w.sourceActivityType ?? "(sem tipo)"]; return c ? [[String(i), c]] : []; })), staged: analysis.staged };
      const res = await fetch("/api/import/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json()) as Report & { message?: string };
      if (!res.ok) { setError(body.message ?? "A importação falhou. Nada foi marcado como concluído."); return; }
      setReport(body); setAnalysis(null);
    } catch {
      setError("Falha ao enviar a importação.");
    } finally { setBusy(false); }
  }

  const nothingChosen = analysis?.format === "apple_health" && sources.size === 0;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        Aceita o <strong>export.xml</strong> do app Saúde (Apple Health) — descompacte o export.zip no app Arquivos —, ou arquivos <strong>GPX/TCX</strong> de um treino.
        Só dados reais do seu arquivo são importados; nada é inventado nem completado.
      </p>
      <input type="file" accept=".xml,.gpx,.tcx,text/xml,application/xml" aria-label="Arquivo de exportação" className={inputClass}
        onChange={(e) => { setFile(e.target.files?.[0] ?? null); setAnalysis(null); setReport(null); setError(null); }} />
      <div><button type="button" disabled={!file || busy} onClick={analyze} className={`${secondaryButton} disabled:opacity-60`}>{busy && !analysis ? "Lendo…" : "Ler arquivo"}</button></div>

      {error ? <p role="alert" className="rounded-xl bg-demo-soft px-3 py-2 text-sm text-demo">{error}</p> : null}

      {analysis ? (
        <div className="grid gap-3 rounded-xl bg-surface-muted p-3">
          <p className="text-sm">
            Arquivo {analysis.format === "apple_health" ? "do Apple Health" : analysis.format.toUpperCase()} ({(analysis.bytes / 1_048_576).toFixed(1)} MB) ·{" "}
            {analysis.staged.workouts.length} treino(s) encontrado(s).
          </p>
          {analysis.format === "apple_health" ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">De qual origem importar?</legend>
              {[...new Set((analysis.inventory ?? []).map((r) => r.sourceName))].map((name) => (
                <label key={name} className="rounded-lg border border-border bg-surface p-2 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={sources.has(name)} onChange={(e) => setSources((prev) => { const next = new Set(prev); if (e.target.checked) next.add(name); else next.delete(name); return next; })} />
                    <span className="font-medium">{name}</span>
                    {looksLikeAmazfit(name) ? <span className="text-xs text-accent">parece ser o Amazfit/Zepp</span> : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {(analysis.inventory ?? []).filter((r) => r.sourceName === name).map((r) => `${r.type.startsWith("Workout:") ? "Treinos (" + r.type.slice(8).replace("HKWorkoutActivityType", "") + ")" : (TYPE_LABELS[r.type] ?? r.type)}: ${r.count} (${r.first.slice(0, 10)} a ${r.last.slice(0, 10)})`).join(" · ")}
                  </span>
                </label>
              ))}
              {(analysis.inventory ?? []).length === 0 ? <p className="text-sm text-muted">Nenhum dado de sono, FC de repouso, HRV ou treino neste arquivo.</p> : null}
            </fieldset>
          ) : null}
          {unknownTypes.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Que modalidade é cada tipo de atividade?</legend>
              <p className="text-xs text-muted">O app não adivinha. Sem escolha, esses treinos não são importados.</p>
              {unknownTypes.map((t) => (
                <label key={t} className="flex items-center justify-between gap-3 text-sm">
                  <span>{t}</span>
                  <select value={choices[t] ?? ""} onChange={(e) => setChoices((prev) => { const next = { ...prev }; if (e.target.value) next[t] = e.target.value as Modality; else delete next[t]; return next; })} className={`${inputClass} max-w-56`} aria-label={`Modalidade para ${t}`}>
                    <option value="">Não importar</option>
                    {MODALITIES.filter((m) => m !== "rest").map((m) => <option key={m} value={m}>{MODALITY_LABELS[m]}</option>)}
                  </select>
                </label>
              ))}
            </fieldset>
          ) : null}
          <div><button type="button" disabled={busy || nothingChosen} onClick={commit} className={`${primaryButton} disabled:opacity-60`}>{busy ? "Importando…" : "Importar"}</button></div>
          {nothingChosen ? <p className="text-xs text-muted">Marque ao menos uma origem.</p> : null}
        </div>
      ) : null}

      {report ? (
        <div role="status" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">
          Importação concluída: {report.inserted} novo(s) registro(s), {report.skipped} já existiam (ignorados) de {report.received} lidos.
          {report.warnings.length ? <ul className="mt-1 list-disc pl-5 text-xs">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}

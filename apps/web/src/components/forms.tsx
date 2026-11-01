import type { ReactNode } from "react";

export const inputClass = "min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base";
export const primaryButton = "min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground";
export const secondaryButton = "min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-medium";

/** Result of the last action, carried in the URL (?ok= / ?erro=). Text comes from our own actions. */
export function Notice({ ok, erro }: { ok?: string; erro?: string }) {
  if (!ok && !erro) return null;
  return (
    <p role={erro ? "alert" : "status"} className={`mb-4 rounded-xl px-3 py-2 text-sm ${erro ? "bg-demo-soft text-demo" : "bg-accent-soft text-accent"}`}>
      {erro ?? ok}
    </p>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** 1..5 self-report. Empty = not answered (stored as unknown, never as a number). */
export function ScoreSelect({ name, label, low, high }: { name: string; label: string; low: string; high: string }) {
  return (
    <Field label={label} htmlFor={name} hint={`1 = ${low} · 5 = ${high}`}>
      <select id={name} name={name} defaultValue="" className={inputClass}>
        <option value="">Não informar</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </Field>
  );
}

export const firstParam = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

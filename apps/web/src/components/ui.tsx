import type { ReactNode } from "react";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-5 pt-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
    </header>
  );
}

export function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 md:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Empty state: says what is missing and why, never invents content. */
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div data-testid="empty-state" className="rounded-xl bg-surface-muted px-4 py-5 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-prose text-sm text-muted">{description}</p> : null}
    </div>
  );
}

/** Marks illustrative content. Anything rendered inside a DemoCard is NOT the user's data. */
export function DemoBadge() {
  return (
    <span
      data-testid="demo-badge"
      className="inline-flex shrink-0 items-center rounded-full bg-demo-soft px-2.5 py-0.5 text-xs font-semibold text-demo"
    >
      Demonstração
    </span>
  );
}

export function DemoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      data-demo="true"
      aria-label={`${title} (demonstração, não são dados reais)`}
      className="rounded-2xl border border-dashed border-demo/60 bg-surface p-4 md:p-5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        <DemoBadge />
      </div>
      <p className="mb-3 text-xs text-demo">Exemplo ilustrativo do layout. Não são dados reais nem uma recomendação.</p>
      {children}
    </section>
  );
}

export function StatusPill({ tone, children }: { tone: "neutral" | "ok" | "warn"; children: ReactNode }) {
  const styles = {
    neutral: "bg-surface-muted text-muted",
    ok: "bg-accent-soft text-accent",
    warn: "bg-demo-soft text-demo",
  } as const;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}

export function DisabledButton({ children, reason }: { children: ReactNode; reason: string }) {
  return (
    <button
      type="button"
      disabled
      title={reason}
      className="min-h-11 cursor-not-allowed rounded-xl border border-border bg-surface-muted px-4 text-sm font-medium text-muted"
    >
      {children}
    </button>
  );
}

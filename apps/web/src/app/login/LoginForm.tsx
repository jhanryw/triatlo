"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, { error: null });
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base" />
      </div>
      {state.error ? <p role="alert" className="text-sm text-demo">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60">
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

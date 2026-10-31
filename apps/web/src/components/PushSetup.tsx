"use client";

import { useEffect, useState } from "react";
import type { PublicConfig } from "@/lib/env";
import { disablePush, enablePush, type EnablePushResult } from "@/lib/push/client";
import {
  PUSH_STATE_MESSAGES,
  detectPushEnvironment,
  resolvePushState,
  type PushEnvironment,
} from "@/lib/push/capability";

const FAILURE_MESSAGES: Record<Exclude<EnablePushResult, { ok: true }>["reason"], string> = {
  not_configured: "As notificações ainda não estão configuradas.",
  permission_denied: "A permissão foi negada. Você pode reativá-la nas configurações do dispositivo.",
  dismissed: "Nenhuma permissão foi concedida. Você pode tentar novamente quando quiser.",
  server_rejected: "Não foi possível registrar este dispositivo no servidor. Nada foi ativado.",
  unexpected: "Algo deu errado ao ativar as notificações. Nada foi ativado.",
};

/**
 * Notifications card. The permission prompt is only requested from the button's click handler
 * (explicit user action) and only when the push backend is configured.
 */
export function PushSetup({ config }: { config: PublicConfig }) {
  const [env, setEnv] = useState<PushEnvironment | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detectPushEnvironment().then((detected) => {
      if (!cancelled) setEnv(detected);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (env === null) {
    return <p className="text-sm text-muted">Verificando suporte do dispositivo…</p>;
  }

  const state = resolvePushState(env, config);
  const message = PUSH_STATE_MESSAGES[state];

  async function onEnable() {
    setBusy(true);
    setNotice(null);
    const result = await enablePush(config);
    if (result.ok) {
      setEnv(await detectPushEnvironment());
    } else {
      setNotice(FAILURE_MESSAGES[result.reason]);
    }
    setBusy(false);
  }

  async function onDisable() {
    setBusy(true);
    setNotice(null);
    const done = await disablePush();
    if (!done) setNotice("Não foi possível desativar agora. Tente novamente.");
    setEnv(await detectPushEnvironment());
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{message.title}</p>
        <p className="mt-1 text-sm text-muted">{message.body}</p>
      </div>

      {state === "ready" ? (
        <button
          type="button"
          onClick={onEnable}
          disabled={busy}
          className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {busy ? "Ativando…" : "Ativar notificações"}
        </button>
      ) : null}

      {state === "subscribed" ? (
        <button
          type="button"
          onClick={onDisable}
          disabled={busy}
          className="min-h-11 rounded-xl border border-border px-4 text-sm font-medium disabled:opacity-60"
        >
          Desativar notificações
        </button>
      ) : null}

      {state === "backend_unavailable" ? (
        <button
          type="button"
          disabled
          className="min-h-11 cursor-not-allowed rounded-xl border border-border bg-surface-muted px-4 text-sm font-medium text-muted"
        >
          Ativar notificações (indisponível)
        </button>
      ) : null}

      {notice ? (
        <p role="status" className="text-sm text-demo">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

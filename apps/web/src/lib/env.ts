import { firstRuntimeEnv } from "./runtime-env";

/**
 * Public (browser-visible) configuration, read at RUNTIME on the server (see runtime-env.ts) and passed to client
 * components as props. Secrets (service/secret keys, VAPID private key) must never be read from this app.
 */
export interface PublicConfig {
  /** Real Web Push is only enabled when the backend (worker + subscription storage) exists. */
  pushEnabled: boolean;
  vapidPublicKey: string | null;
}

export function parsePublicConfig(raw: { pushEnabled?: string; vapidPublicKey?: string }): PublicConfig {
  const key = raw.vapidPublicKey?.trim();
  return {
    pushEnabled: raw.pushEnabled === "true",
    vapidPublicKey: key ? key : null,
  };
}

/** Server-only. Accepts the NEXT_PUBLIC_* names already configured in EasyPanel and plain names. */
export function readPublicConfig(): PublicConfig {
  return parsePublicConfig({
    pushEnabled: firstRuntimeEnv("NEXT_PUBLIC_PUSH_ENABLED", "PUSH_ENABLED"),
    vapidPublicKey: firstRuntimeEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PUBLIC_KEY"),
  });
}

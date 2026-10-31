/**
 * Public (browser-visible) runtime configuration. Only NEXT_PUBLIC_* variables are read here:
 * they are inlined at build time, so each one must be referenced literally.
 * Secrets (service/secret keys, VAPID private key) must never be read from this app.
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

export function readPublicConfig(): PublicConfig {
  return parsePublicConfig({
    pushEnabled: process.env.NEXT_PUBLIC_PUSH_ENABLED,
    vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  });
}

import type { PushConsentRecord } from "@triatlo/shared";
import type { PublicConfig } from "@/lib/env";

/** Bump when the explanation shown before the permission prompt changes. */
export const PUSH_CONSENT_TEXT_VERSION = "2026-11-01";

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "permission_denied" | "dismissed" | "server_rejected" | "unexpected" };

/** Converts a base64url VAPID public key into the byte array expected by pushManager.subscribe. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Enables Web Push. MUST be called from a direct user interaction (button tap): iOS requires it and the
 * product requires explicit consent. The subscription is persisted by the server (Delivery 4); until the
 * endpoint exists it answers 501 and we roll the browser subscription back so nothing dangles.
 */
export async function enablePush(config: PublicConfig): Promise<EnablePushResult> {
  if (!config.pushEnabled || config.vapidPublicKey === null) return { ok: false, reason: "not_configured" };

  try {
    const registration = await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission === "denied") return { ok: false, reason: "permission_denied" };
    if (permission !== "granted") return { ok: false, reason: "dismissed" };

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
    });

    const nav = navigator as Navigator & { standalone?: boolean };
    const consent: PushConsentRecord = {
      grantedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      consentTextVersion: PUSH_CONSENT_TEXT_VERSION,
      displayMode:
        window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true ? "standalone" : "browser",
    };

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), consent }),
    });

    if (!response.ok) {
      await subscription.unsubscribe();
      return { ok: false, reason: "server_rejected" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "unexpected" };
  }
}

export async function disablePush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return true;
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    return await subscription.unsubscribe();
  } catch {
    return false;
  }
}

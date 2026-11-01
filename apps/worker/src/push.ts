import webpush from "web-push";

export interface PushTarget { endpoint: string; keys: { p256dh: string; auth: string } }
export interface PushResult { ok: boolean; statusCode: number | null }
/** Sends ONE push message. Injectable so delivery logic is testable without a push service. */
export interface PushSender { send(target: PushTarget, payload: string): Promise<PushResult> }

export function createWebPushSender(vapid: { subject: string; publicKey: string; privateKey: string }): PushSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    async send(target, payload) {
      try {
        const r = await webpush.sendNotification(target, payload, { TTL: 3600, urgency: "normal" });
        return { ok: r.statusCode >= 200 && r.statusCode < 300, statusCode: r.statusCode };
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        return { ok: false, statusCode: typeof status === "number" ? status : null };
      }
    },
  };
}

import { PushConsentRecordSchema, PushSubscriptionInputSchema } from "@triatlo/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/ctx";

export const dynamic = "force-dynamic";

const SubscribeBodySchema = z.object({
  subscription: PushSubscriptionInputSchema,
  consent: PushConsentRecordSchema,
});

/**
 * Stores this device's push subscription for the signed-in user, with the consent evidence. RLS keeps it private to the
 * user; only the worker can read the encryption keys back. Re-subscribing the same endpoint replaces the old row.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = SubscribeBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { subscription, consent } = body.data;
  const { db, userId } = session.ctx;

  const removed = await db.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", userId);
  if (removed.error) return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  const inserted = await db.from("push_subscriptions").insert({
    user_id: userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, user_agent: consent.userAgent,
    display_mode: consent.displayMode, consent_text_version: consent.consentTextVersion, consent_at: consent.grantedAt,
  });
  if (inserted.error) return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  // Notifications are only delivered when the user also has the preference on.
  await db.from("user_preferences").upsert({ user_id: userId, notifications_enabled: true }, { onConflict: "user_id" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = z.object({ endpoint: z.url() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const res = await session.ctx.db.from("push_subscriptions").delete().eq("endpoint", body.data.endpoint).eq("user_id", session.ctx.userId);
  if (res.error) return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

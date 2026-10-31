import { PushConsentRecordSchema, PushSubscriptionInputSchema } from "@triatlo/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SubscribeBodySchema = z.object({
  subscription: PushSubscriptionInputSchema,
  consent: PushConsentRecordSchema,
});

const NOT_IMPLEMENTED = {
  error: "push_backend_not_configured",
  message: "Web Push storage is implemented in Delivery 4 (needs authentication, database and worker).",
} as const;

/**
 * Delivery 1 stub: validates the contract and answers 501. It deliberately stores nothing and sends nothing.
 * Delivery 4 replaces this with: authenticated user -> persist subscription + consent -> RLS-protected table.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!SubscribeBodySchema.safeParse(body).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

export async function DELETE(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!z.object({ endpoint: z.url() }).safeParse(body).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

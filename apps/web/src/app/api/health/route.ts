import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe for Docker/EasyPanel. Must not expose configuration, user data or secrets. */
export function GET() {
  return NextResponse.json(
    { status: "ok", service: "triatlo-web", commit: process.env.APP_COMMIT_SHA ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

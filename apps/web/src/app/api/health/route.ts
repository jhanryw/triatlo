import { NextResponse } from "next/server";
import { readPublicConfig } from "@/lib/env";
import { readSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for Docker/EasyPanel. Reports only whether configuration is PRESENT (booleans); never values,
 * user data or secrets. Connectivity to Supabase is checked separately in /api/health/supabase.
 */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "triatlo-web",
      commit: process.env.APP_COMMIT_SHA || null,
      config: { supabaseConfigured: readSupabaseEnv() !== null, pushEnabled: readPublicConfig().pushEnabled },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

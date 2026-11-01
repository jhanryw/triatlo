import { NextResponse } from "next/server";
import { classifyKey, inspectRuntimeSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/**
 * Server-side connectivity probe: can this deployment reach the Supabase gateway and is the PUBLIC key accepted?
 * Returns only status facts (no URLs, no keys). It performs a read-only call to the Auth health endpoint.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const { env, problem } = inspectRuntimeSupabaseEnv();
  if (!env) {
    // `problem` is a fixed vocabulary (missing, invalid_url, refused_demo_key, refused_privileged_key): never a value.
    return NextResponse.json({ configured: false, reachable: false, keyAccepted: false, problem }, { headers });
  }
  try {
    const response = await fetch(`${env.url}/auth/v1/health`, {
      headers: { apikey: env.publishableKey },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    return NextResponse.json(
      {
        configured: true,
        reachable: true,
        keyKind: classifyKey(env.publishableKey),
        authHealthStatus: response.status,
        keyAccepted: response.status === 200,
      },
      { headers },
    );
  } catch {
    return NextResponse.json({ configured: true, reachable: false, keyAccepted: false }, { headers });
  }
}

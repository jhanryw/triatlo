import { redirect } from "next/navigation";
import type { Ctx } from "@triatlo/data";
import { getProfile } from "@triatlo/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectRuntimeSupabaseEnv } from "@/lib/supabase/env";

export interface Session { ctx: Ctx; email: string | null; timezone: string | null }

/** The signed-in user (verified with the Auth server, not just read from the cookie), or null. */
export async function getSession(): Promise<Session | null> {
  if (!inspectRuntimeSupabaseEnv().env) return null;
  const db = await createServerSupabaseClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  const profile = await getProfile({ db, userId: data.user.id }).catch(() => null);
  return { ctx: { db, userId: data.user.id }, email: data.user.email ?? null, timezone: profile?.timezone ?? null };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

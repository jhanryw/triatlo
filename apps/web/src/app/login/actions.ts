"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectRuntimeSupabaseEnv } from "@/lib/supabase/env";

export async function signIn(_prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  if (!inspectRuntimeSupabaseEnv().env) return { error: "O serviço de dados não está configurado." };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Informe e-mail e senha." };
  const db = await createServerSupabaseClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  // One generic message: never reveal whether the e-mail exists.
  if (error) return { error: "E-mail ou senha incorretos." };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const db = await createServerSupabaseClient();
  await db.auth.signOut();
  redirect("/login");
}

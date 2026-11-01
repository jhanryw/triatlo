import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";
import { inspectRuntimeSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

const PROBLEMS: Record<string, string> = {
  missing: "O serviço de dados ainda não está configurado neste ambiente.",
  invalid_url: "O endereço do serviço de dados é inválido.",
  refused_demo_key: "A chave configurada é uma chave de demonstração pública e foi recusada por segurança. Troque as credenciais do Supabase.",
  refused_privileged_key: "Uma chave privilegiada foi colocada numa variável pública e foi recusada. Use apenas a chave anônima.",
};

export default function LoginPage() {
  const { problem } = inspectRuntimeSupabaseEnv();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Triatlo Inteligente</h1>
        <p className="mt-1 text-sm text-muted">Acesso pessoal. Não há cadastro: a conta é criada pelo administrador.</p>
      </div>
      {problem ? <p role="alert" className="rounded-xl bg-demo-soft px-3 py-2 text-sm text-demo">{PROBLEMS[problem]}</p> : <LoginForm />}
    </main>
  );
}

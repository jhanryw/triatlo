import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-muted">O endereço não existe neste app.</p>
      <Link href="/" className="mt-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground">
        Voltar para Hoje
      </Link>
    </main>
  );
}

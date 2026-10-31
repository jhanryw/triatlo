# supabase/migrations

SQL versionado e imutável (forward-only) — única fonte de verdade do schema. Aplicado por passo explícito, nunca no boot da aplicação, sempre após backup. Toda tabela nova inclui `user_id`, RLS e teste em `supabase/tests`. **Vazio — Entrega 2.**

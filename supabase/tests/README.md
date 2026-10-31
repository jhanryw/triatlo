# supabase/tests

Testes SQL de RLS, privilégios, integridade e fila — rodam em um banco **descartável** (`DATABASE_URL=… bash supabase/tests/run.sh` ou `npm run db:test`):

1. `00_ci_prelude.sql` — cria stand-ins (roles, `auth`, `storage`) só quando o banco é "bare PostgreSQL"; na imagem do Supabase quase nada é criado.
2. `migrate.sh` é executado **duas vezes** (a segunda deve ser no-op).
3. `10`…`50` — cada arquivo roda numa transação revertida e falha com `ASSERTION FAILED: …`.

Cobertura: toda tabela de `public` tem RLS (tabela nova sem RLS **quebra o CI**); `anon` sem acesso; isolamento entre usuários (leitura, escrita, FK composta); versões/aprovações/auditoria imutáveis; ciclo de vida das propostas; ausente × parcial × zero; proveniência e importação idempotente; chaves de push ilegíveis ao cliente; fila só para `service_role` (reivindicação exclusiva, lease, retentativa, dead letter, supersessão); Storage privado por pasta de usuário. Executados no job `database` do CI com a imagem real `supabase/postgres`.

**Nunca aponte `DATABASE_URL` para um banco real.**

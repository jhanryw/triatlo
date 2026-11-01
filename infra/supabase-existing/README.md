# infra/supabase-existing

Ferramentas para operar a **instalação Supabase existente** (Kong) no EasyPanel — decisão A-24. Procedimento completo: [`docs/SUPABASE_EXISTING.md`](../../docs/SUPABASE_EXISTING.md).

| Script (rodar no host do servidor, por SSH) | O que faz | Altera algo? |
|---|---|---|
| `scripts/inspect-existing-stack.sh` | Inventário: versões, compose, portas, redes, volumes, configurações não secretas, **detecção de credenciais padrão por hash** (sem imprimir segredos) | Não (somente leitura) |
| `scripts/backup-existing.sh --db <db>` | `pg_dump -Fc` + roles + (opcional) arquivos do Storage, verificados e com SHA-256 | Só cria arquivos em `--out` |
| `scripts/restore-rehearsal.sh --db <db> --dump <arq>` | Restaura em banco descartável `restore_test` e o remove | Cria e remove só `restore_test` |
| `scripts/make-rotation-env.sh` (no seu Mac) | Isola o trio legado compatível com o Kong em `~/.triatlo-secrets/supabase-kong-rotation.env` | Só arquivo local (600) |

Migrations e testes: `supabase/migrate.sh --container <db>` e `supabase/tests/run.sh --production --container <db>`.

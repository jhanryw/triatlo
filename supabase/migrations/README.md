# supabase/migrations

SQL versionado e imutável (forward-only). Aplicação: `bash supabase/migrate.sh --container <container-db>` (no servidor) ou `DATABASE_URL=… bash supabase/migrate.sh`.

- Cada arquivo roda em **uma transação** e é registrado com checksum em `supabase_migrations.triatlo_applied`; alterar um arquivo já aplicado **interrompe** a execução (crie uma migration nova).
- Statements destrutivos (`DROP TABLE/SCHEMA/COLUMN`, `TRUNCATE`, `DELETE FROM`) são **recusados** sem a linha `-- allow-destructive: <motivo>` (exige autorização do proprietário).
- Sempre depois de um backup verificado (`infra/backup/RESTORE.md`). Esquema documentado em `docs/DATABASE_SCHEMA.md`.

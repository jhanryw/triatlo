# Origem e política de atualização

Esta pasta contém a stack **oficial** de Supabase self-hosted, adaptada para um serviço *Compose* do EasyPanel.

| Item | Valor |
|---|---|
| Repositório | https://github.com/supabase/supabase (diretório `docker/`) |
| Release fixada | tag `self-hosted/v0.8.3` |
| Commit | `bc27d2661edd09a5d0b8d76ce33da6d4071a756e` |
| Imagens (tags do upstream, inalteradas) | `supabase/postgres:17.6.1.136`, `supabase/gotrue:v2.197.0`, `postgrest/postgrest:v14.18`, `supabase/storage-api:v1.81.0`, `supabase/studio:2026.10.12-sha-3699278`, `supabase/postgres-meta:v0.100.0`, `supabase/realtime:v2.143.3`, `supabase/supavisor:2.9.13`, `supabase/edge-runtime:v1.77.4`, `darthsim/imgproxy:v3.31.4`, `envoyproxy/envoy:v1.39.1` |
| Licença | Apache-2.0 (`LICENSE` nesta pasta) |

## Arquivos

- `upstream/docker-compose.upstream.yml` — cópia **intocada** do compose oficial (auditoria de deriva); `upstream/versions.md` — histórico de imagens do upstream.
- `docker-compose.yml` — a versão que o EasyPanel executa. Todas as diferenças estão em `CHANGES-vs-upstream.diff` (gerado com `diff -u`).
- `volumes/` — somente os arquivos de configuração que o compose monta (Envoy, SQL de inicialização, pooler, função `main`). **Não há segredos** nesses arquivos.
- `utils/generate-keys.sh`, `utils/add-new-auth-keys.sh` — geradores oficiais, copiados sem alteração e usados por `scripts/prepare-env.sh`.
- `.env.example` — **sem segredos** (valores secretos vazios; os reais são gerados fora do repositório).
- `backup/backup.sh` + serviço `backup` — adição do projeto (não existe no upstream).

## Diferenças em relação ao upstream (resumo)

1. `name: triatlo-supabase` (o upstream usa `supabase`; evita colisão com outra stack no mesmo host).
2. Sem `container_name` (o EasyPanel os sinaliza como incompatíveis; o `realtime` mantém o hostname `realtime-dev.supabase-realtime` por *network alias*).
3. **Sem `ports:`**: o upstream publica `8000` (gateway) e `5432/6543` (pooler/PostgreSQL) no host; aqui nada é publicado — o proxy do EasyPanel alcança `api-gw:8000` pela rede Docker.
4. Dados persistentes em **volumes nomeados** (`db-data`, `storage-data`, `studio-snippets`) em vez de *bind mounts* dentro do checkout Git.
5. Linhas JWKS descomentadas (`GOTRUE_JWT_KEYS`, `API_JWT_JWKS`, `JWT_JWKS`, `SUPABASE_JWKS`) — é o que o script oficial `add-new-auth-keys.sh` faz para habilitar o par de chaves assimétricas e as chaves opacas `sb_publishable_`/`sb_secret_`.
6. Serviço `backup` (dumps lógicos + arquivo de Storage) e volume `db-backups`.

`npm run supabase:check` (também no CI) falha se alguma dessas garantias for quebrada (porta publicada, `container_name`, tag diferente do upstream, variável não declarada, segredo preenchido no `.env.example`).

## Como atualizar (nunca automaticamente)

1. Ler o changelog do upstream e o `versions.md`; escolher uma nova tag `self-hosted/vX.Y.Z`.
2. **Backup completo e restauração testada antes** (ver `infra/backup/RESTORE.md`).
3. Reproduzir os passos desta pasta com a nova tag, gerar novo `CHANGES-vs-upstream.diff`, rodar `npm run supabase:check`.
4. Atualizar este arquivo (tag, commit, imagens) e `docs/DECISIONS.md`. Nunca misturar versões de imagens soltas.

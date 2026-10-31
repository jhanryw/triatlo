# Restauração do Supabase (Triatlo Inteligente)

> Estado: **rascunho a ensaiar.** O serviço `backup` e este procedimento foram escritos, mas **nunca executados** (sem Docker local, nada implantado). A restauração só conta como "documentada e validada" depois de ser ensaiada conforme a parte B e registrada em `docs/DECISIONS.md`.

Onde executar: terminal do servidor (SSH ou "Console" do serviço no EasyPanel). Descubra os nomes reais dos containers (o Compose os gera):

```bash
docker ps --format '{{.Names}}' | grep -E 'triatlo|supabase'   # procure os containers "db" e "backup"
```

O que existe a cada execução do backup (volume `db-backups`, pasta `/backups` no container `backup`):
`triatlo-db-<UTC>.dump` (pg_dump formato custom), `triatlo-globals-<UTC>.sql` (roles; contém hashes de senha), `triatlo-storage-<UTC>.tar.gz` (fotos privadas), `*.sha256`, `LAST_STATUS`. Com `BACKUP_ENCRYPTION_PASSPHRASE`, os arquivos terminam em `.enc`.

## A. Conferir integridade (não destrutivo, rotina)

```bash
docker exec <container-backup> sh -c 'cat /backups/LAST_STATUS; ls -lh /backups | tail -8'
docker exec <container-backup> sh -c 'cd /backups && sha256sum -c triatlo-db-<UTC>.dump.sha256'
docker exec <container-backup> pg_restore --list /backups/triatlo-db-<UTC>.dump | head
```

`LAST_STATUS` deve começar com `ok`. Se for `failed`, veja os logs do container `backup`.

## B. Ensaio de restauração (não destrutivo — **obrigatório antes de considerar o backup válido**)

Restaura o dump num banco **descartável dentro do mesmo servidor PostgreSQL**, sem tocar no banco `postgres` de produção.

```bash
# 1. banco descartável
docker exec <container-db> psql -U supabase_admin -d postgres -c 'CREATE DATABASE restore_test;'
# 2. restaurar (avisos sobre extensões/owners existentes são esperados; erros de dados não são)
docker exec <container-backup> pg_restore --dbname=restore_test --no-owner --no-privileges /backups/triatlo-db-<UTC>.dump
# 3. validar: tabelas do usuário e contagens
docker exec <container-db> psql -U supabase_admin -d restore_test -c 'SELECT count(*) AS usuarios FROM auth.users;'
docker exec <container-db> psql -U supabase_admin -d restore_test -c '\dt public.*'
# 4. descartar
docker exec <container-db> psql -U supabase_admin -d postgres -c 'DROP DATABASE restore_test;'
```

Registre a data e o resultado do ensaio. Repita trimestralmente e antes de cada atualização do Supabase.

## C. Recuperação de desastre (servidor/volumes perdidos) — **a ensaiar**

Pré-requisito crítico: o novo `.env` deve ser **o mesmo** (mesmos `POSTGRES_PASSWORD`, `JWT_SECRET`/chaves JWT, `VAULT_ENC_KEY` etc.), guardado fora do servidor. Sem ele, usuários, tokens e dados criptografados não são recuperáveis. Guarde `~/.triatlo-secrets/supabase.env` em um cofre de senhas.

1. Recriar o serviço Compose no EasyPanel com o mesmo repositório e o mesmo `.env`; fazer o primeiro deploy e esperar todos os serviços saudáveis (banco novo e vazio).
2. Parar os serviços que usam o banco (`auth`, `rest`, `storage`, `realtime`, `meta`, `studio`, `supavisor`) para evitar escrita durante a restauração; manter `db` rodando.
3. Restaurar o dump no banco `postgres` (ajuste flags após o ensaio da parte B; o objetivo é recriar objetos de aplicação sem recriar roles do sistema):
   ```bash
   docker cp triatlo-db-<UTC>.dump <container-db>:/tmp/restore.dump      # trazido do destino externo
   docker exec <container-db> pg_restore --dbname=postgres --clean --if-exists --no-owner /tmp/restore.dump
   ```
4. Restaurar os arquivos do Storage no volume `storage-data`:
   ```bash
   docker run --rm -v <volume-storage-data>:/data -v "$PWD":/in alpine sh -c 'cd /data && tar -xzf /in/triatlo-storage-<UTC>.tar.gz'
   ```
5. Subir os serviços novamente, rodar `bash infra/supabase/scripts/smoke-test.sh --api-url https://… --login` e abrir uma foto de teste.

Se o ensaio da parte B ou C revelar flags diferentes, **atualize este arquivo** — ele é a fonte da verdade do procedimento.

## D. Cópia externa dos backups (pendente: escolha do destino — Q-03)

Opções (nenhuma configurada ainda):

1. **Backup de volume do EasyPanel** apontando o volume `db-backups` para um provedor S3-compatível ✅ o EasyPanel documenta backups agendados de volume para serviços *App*; **não confirmado** que o recurso exista para volumes de serviços Compose.
2. **rclone/S3 em um serviço adicional** que sincroniza `/backups` para um bucket externo criptografado (exige credenciais do destino e decisão de custo).
3. **Cópia manual periódica** (`scp`/`rsync` para o seu computador) — apenas como paliativo.

Sem uma dessas opções ativas, **não existe backup externo**.

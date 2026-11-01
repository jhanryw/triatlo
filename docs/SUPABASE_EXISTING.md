# SUPABASE_EXISTING — operar e adaptar o Triatlo à instalação Supabase existente (Kong)

> **Decisão A-24 (2026-10-31):** mantemos a instalação atual do Supabase self-hosted no EasyPanel. Não criamos outra instância, não trocamos Kong por Envoy e não reconstruímos nada. A stack `infra/supabase` (Envoy) fica **apenas como referência**; este documento é o roteiro vigente.
>
> Instalação: `https://qarvon-supabase-triatlo.uxxkgy.easypanel.host` · App: `https://qarvon-triatlo.uxxkgy.easypanel.host`.
> Eu não tenho acesso ao EasyPanel nem ao servidor: tudo que depende deles é um passo seu abaixo. Nomes de containers **não são inventados**: o script de inspeção os imprime.

## 1. O que se sabe da instalação (verificado de fora, 2026-10-31)

| Item | Valor | Como foi obtido |
|---|---|---|
| Gateway | Kong **3.9.1** | cabeçalhos `server`/`via` |
| Auth | GoTrue **v2.186.0** | `/auth/v1/health` |
| API de dados | PostgREST **14.8** | OpenAPI de `/rest/v1/` |
| Compose de origem | **inferido**: snapshot do `docker/` do upstream entre 2026-04-08 e 2026-06-02 (as tags oficiais só começam em junho; nenhuma tem gotrue v2.186 + postgrest 14.8). Nessa época o banco era `supabase/postgres:15.8.1.085` ⇒ **PostgreSQL 15 provável**, **a confirmar** | `versions.md` do upstream |
| Exposição | Portas 5432, 6543, 8000, 8443 **fechadas** para a Internet (IP `82.25.68.222`); a 3000 aberta é o painel do EasyPanel (não tocar) | teste de conexão TCP |
| **Credenciais** | 🔴 **JWT_SECRET padrão público em uso**: a chave anon de demonstração é aceita; nenhuma chave gerada por nós é aceita | testes de status HTTP |
| Cadastro público | desconhecido (a inspeção informa `DISABLE_SIGNUP`) | — |
| Compose/Kong/volumes/rede | **desconhecidos** até rodar a inspeção | passo 2 |

Chaves compatíveis com o Kong: **apenas o trio legado HS256** (`JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`). As chaves opacas/assimétricas geradas para a stack Envoy (`sb_publishable_…`, `sb_secret_…`, `JWT_KEYS`, `JWT_JWKS`) **não** são usadas aqui. Verifiquei localmente o trio já gerado: assinatura válida com o `JWT_SECRET` (40 caracteres), papéis `anon`/`service_role`, validade de 5 anos, emissor `supabase`. Ele está isolado em `~/.triatlo-secrets/supabase-kong-rotation.env` (modo 600).

## 2. Inspecionar a instalação existente (somente leitura, no servidor por SSH)

```bash
git clone --depth 1 https://github.com/jhanryw/triatlo.git ~/triatlo-ops     # repositório público; só cria uma pasta no seu home
less ~/triatlo-ops/infra/supabase-existing/scripts/inspect-existing-stack.sh   # leia antes de executar
bash ~/triatlo-ops/infra/supabase-existing/scripts/inspect-existing-stack.sh
```

Ele **não altera nada** (só `docker ps/inspect/port` e `SELECT`s) e **não imprime segredos**: valores de ambiente são comparados por SHA-256 com as credenciais de demonstração públicas do upstream e reportados como `DEFAULT DEMO VALUE: container=… variable=…`. Mostra: projeto e arquivos do Compose (`working_dir`, `config_files`), todos os containers e imagens (inclui a versão real do PostgreSQL), portas publicadas, redes compartilhadas com **outros projetos**, volumes do banco e do Storage, configurações não secretas (URLs, cadastro, SMTP), serviços e caminhos do Kong, e `SELECT`s no banco (versão, tamanho, nº de usuários, tabelas públicas sem RLS, buckets, histórico de migrations). Salva em `~/supabase-existing-inspection-<data>.txt` (modo 600). **Me envie esse arquivo**; ele serve para decidir o passo 3 e para confirmar `<db>`, o nome exato do container PostgreSQL.

## 3. Procedimento mínimo de correção das credenciais demonstrativas (precisa da sua autorização)

Base oficial (docs do Supabase, consultadas em 2026-10-31): mudanças no `.env` só têm efeito ao **recriar** os containers (um restart não relê variáveis); a senha do banco deve ser trocada pelo utilitário oficial (`utils/db-passwd.sh`), não editando só o `.env`; a rotação de `JWT_SECRET` e das chaves de criptografia (`SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY`, `REALTIME_DB_ENC_KEY`) **não está documentada** como procedimento para instâncias já iniciadas ⇒ só o estritamente necessário, com backup. O EasyPanel, ao dar **Deploy** num serviço Compose, executa `docker compose up --build -d` e recria o que mudou.

**Fase 1 — obrigatória, só variáveis de ambiente, sem tocar no banco**
1. Pré-requisitos: inspeção (passo 2) e backup (passo 4) feitos.
2. EasyPanel → projeto `qarvon` → serviço `supabase-triatlo` → aba de ambiente. Os **nomes** das variáveis valem os que a inspeção marcou como `DEFAULT DEMO VALUE` (no formato oficial são `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`; confirme na tela). Substitua **somente** os valores marcados, usando `~/.triatlo-secrets/supabase-kong-rotation.env` (copie um valor sem exibi-lo: `grep '^JWT_SECRET=' ~/.triatlo-secrets/supabase-kong-rotation.env | cut -d= -f2- | tr -d '\n' | pbcopy`; ou `pbcopy < arquivo` e cole as linhas no editor se ele aceitar formato `.env`). Limpe a área de transferência depois (`pbcopy < /dev/null`).
3. Se `DASHBOARD_PASSWORD` for marcado como padrão, troque-o também (≥ 1 letra; valor em `~/.triatlo-secrets/supabase.env`).
4. **Deploy** do serviço. Não mexa nos outros serviços do projeto.
5. Verificar (do seu Mac): a chave de demonstração deve passar a ser **recusada** e a nova aceita:
   ```bash
   bash infra/supabase/scripts/smoke-test.sh --api-url https://qarvon-supabase-triatlo.uxxkgy.easypanel.host --key-var ANON_KEY --stack kong
   bash ~/triatlo-ops/infra/supabase-existing/scripts/inspect-existing-stack.sh     # no servidor: não deve restar nenhum DEFAULT DEMO VALUE
   ```
   Efeito colateral: tokens emitidos com o segredo antigo deixam de valer — não existem usuários/sessões reais ainda.

**Fase 2 — só se a inspeção marcar `POSTGRES_PASSWORD` como padrão (autorização separada)**
O banco não é alcançável pela Internet, mas pode ser alcançado por outros containers que dividam uma rede Docker (a inspeção informa). A troca correta é a oficial: `ALTER USER … PASSWORD` para todos os papéis + `.env` + recriação; o utilitário oficial também executa `DROP SCHEMA _supavisor CASCADE` (metadados internos do pooler, recriados na subida) — **é destrutivo por definição**, por isso exige sua autorização explícita. Eu preparo os comandos exatos para o seu `docker compose`/EasyPanel **depois** de ver a inspeção; não os escrevo antes para não adivinhar nomes.

**Fase 3 — chaves de criptografia padrão (opcional)**
Se a inspeção marcar `SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY` ou `REALTIME_DB_ENC_KEY`: a rotação não é documentada; só vale fazer com backup e sabendo que Realtime/Supavisor/Studio podem precisar reconstruir dados internos. Decidimos caso a caso.

## 4. Backup antes de qualquer alteração (no servidor)

```bash
bash ~/triatlo-ops/infra/supabase-existing/scripts/backup-existing.sh --db <db> [--storage <container-storage>] --out ~/triatlo-backups
bash ~/triatlo-ops/infra/supabase-existing/scripts/restore-rehearsal.sh --db <db> --dump ~/triatlo-backups/existing-db-<UTC>.dump
```

O primeiro gera dump `-Fc` (verificado com `pg_restore --list`), roles e, opcionalmente, os arquivos do Storage, com SHA-256, em pasta 700. O segundo restaura num banco **descartável** `restore_test` dentro do mesmo servidor e o remove (o banco real nunca é tocado). Depois, **copie os arquivos para fora do servidor** (`scp -r <usuario>@<servidor>:~/triatlo-backups ./`): sem isso não existe backup externo (Q-03).

## 5. Status e *dry-run* das 7 migrations (somente leitura — não escrevem nem a tabela de controle)

```bash
cd ~/triatlo-ops && git pull --ff-only
bash supabase/migrate.sh --container <db> --status      # tudo "pending" (nenhuma aplicada)
bash supabase/migrate.sh --container <db> --dry-run     # lista o que seria aplicado
```

O runner recusa o banco se o PostgreSQL for < 15 (as migrations usam `ON DELETE SET NULL (coluna)`), recusa statements destrutivos sem `-- allow-destructive`, e interrompe se um arquivo já aplicado for editado. Verificado em PostgreSQL descartável: `--status` e `--dry-run` deixam o esquema idêntico.

## 6. Aplicar (**só depois da sua autorização explícita**: me diga "aplicar as migrations")

```bash
bash supabase/migrate.sh --container <db>               # uma transação por arquivo; checksum registrado
bash supabase/migrate.sh --container <db> --status      # 7 × "applied … checksum ok"
bash supabase/tests/run.sh --production --container <db>   # 8 × PASS; tudo revertido; schema auxiliar removido
```

Nenhuma porta do banco é publicada: tudo passa por `docker exec`.

## 7. Conta única e testes por HTTPS (do seu Mac, depois de 3 e 6)

```bash
bash infra/supabase/scripts/create-admin-user.sh --api-url https://qarvon-supabase-triatlo.uxxkgy.easypanel.host      # usa o SERVICE_ROLE_KEY NOVO; cadastro público continua desligado
bash infra/supabase/scripts/smoke-test.sh --api-url https://qarvon-supabase-triatlo.uxxkgy.easypanel.host --key-var ANON_KEY --stack kong --login
bash infra/supabase/scripts/integration-test.sh --api-url https://qarvon-supabase-triatlo.uxxkgy.easypanel.host --key-var ANON_KEY
```

O `integration-test.sh` faz login, grava e lê um check-in de teste (2000-01-01), prova que `anon` não lê registros privados, que não se grava em nome de outro usuário, que chaves de push e fila estão inacessíveis e que o Storage é privado; remove os itens de teste. No Kong, `/functions/v1/…` responde sem chave **por desenho do upstream** (`VERIFY_JWT=false`): o smoke test mostra isso como `WARN` — ver recomendação no passo 9.

## 8. Next.js com o Supabase atual

No serviço `web`: `NEXT_PUBLIC_SUPABASE_URL=https://qarvon-supabase-triatlo.uxxkgy.easypanel.host` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` = **`ANON_KEY` novo** (JWT `anon`, público por desenho; só funciona com RLS). O app aceita também `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` (com ou sem `NEXT_PUBLIC_`), lê em **runtime** (um *restart* basta) e:
- **recusa** a chave de demonstração pública (`problem: "refused_demo_key"`) e qualquer chave privilegiada (`service_role`, `sb_secret_`);
- nunca lê `SERVICE_ROLE_KEY` — credenciais privilegiadas ficam só no backend (worker/scripts).

```bash
grep '^ANON_KEY=' ~/.triatlo-secrets/supabase-kong-rotation.env | cut -d= -f2- | tr -d '\n' | pbcopy     # copia a chave anon sem exibir
curl -s https://qarvon-triatlo.uxxkgy.easypanel.host/api/health            # config.supabaseConfigured: true
curl -s https://qarvon-triatlo.uxxkgy.easypanel.host/api/health/supabase   # reachable: true, keyAccepted: true, keyKind: legacy_anon
```

## 9. Pontos de atenção da stack Kong atual
- `/functions/v1/*` sem chave: não usamos Edge Functions; se o EasyPanel permitir, defina `FUNCTIONS_VERIFY_JWT=true` (ou desligue o serviço `functions`) numa mudança futura, com autorização.
- Studio (`/` do gateway) está atrás de Basic Auth do Kong (401 sem credenciais); não é necessário para o projeto.
- Backups automáticos agendados **não existem** nesta stack (o serviço `backup` era da stack Envoy): por ora o backup é o script do passo 4; o agendamento fica como pendência (Q-03/P-28).
- O worker (Etapa futura) falará com o banco pela API HTTPS com `SERVICE_ROLE_KEY` (P-23).

## 10. Ordem recomendada
inspeção (2) → backup (4) → **[autorização: credenciais]** → fase 1 (3) → conta única (7, primeira linha) → `--status`/`--dry-run` (5) → **[autorização: migrations]** → aplicar + testes (6) → integração HTTPS (7) → web (8).

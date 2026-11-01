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
| **Container PostgreSQL** | `qarvon_supabase-triatlo-db-1` (serviço Compose `db`) — **confirmado pela inspeção do proprietário**. O container `qarvon_supabase-triatlo-meta-1` é o **postgres-meta, não o banco** (não tem `psql`) | inspeção em 2026-10-31 |
| Credenciais | 🔴 a inspeção do servidor **confirmou valores demonstrativos em vários containers**, incluindo JWT, PostgreSQL e chaves de API | inspeção em 2026-10-31 |
| Volumes | os dados ficam em *bind mounts* **dentro do diretório de código do EasyPanel** ⇒ ver §3 (risco de persistência) | relato do proprietário; script revisado |
| Kong/rede/compose completo | a detalhar com a saída da inspeção (cole as seções 1, 3, 4, 5, 5b, 7 e 8 — não contêm segredos) | passo 2 |

Chaves compatíveis com o Kong: **apenas o trio legado HS256** (`JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`). As chaves opacas/assimétricas geradas para a stack Envoy (`sb_publishable_…`, `sb_secret_…`, `JWT_KEYS`, `JWT_JWKS`) **não** são usadas aqui. Verifiquei localmente o trio já gerado: assinatura válida com o `JWT_SECRET` (40 caracteres), papéis `anon`/`service_role`, validade de 5 anos, emissor `supabase`. Ele está isolado em `~/.triatlo-secrets/supabase-kong-rotation.env` (modo 600).

## 2. Inspecionar a instalação existente (somente leitura, no servidor por SSH)

```bash
git clone --depth 1 https://github.com/jhanryw/triatlo.git ~/triatlo-ops     # repositório público; só cria uma pasta no seu home
git -C ~/triatlo-ops pull --ff-only                                           # traz a correção do script (se já tinha clonado)
less ~/triatlo-ops/infra/supabase-existing/scripts/inspect-existing-stack.sh   # leia antes de executar
bash ~/triatlo-ops/infra/supabase-existing/scripts/inspect-existing-stack.sh
```

> **Correção (2026-10-31):** a versão anterior identificava o banco por *substring* do nome da imagem; `supabase/postgres-meta` também contém `supabase/postgres`, e o container `meta` (sem `psql`) foi tomado como banco. Agora o banco é **somente** o serviço Compose `db` com imagem `supabase/postgres:<tag>`, **provado** por consulta SQL, e todos os scripts usam a mesma validação (`supabase/lib/db-guard.sh`) **antes de qualquer escrita**; se houver ambiguidade, recusam e pedem `--db`. Testado com um Docker simulado que inclui o cenário `meta`.

Ele **não altera nada** (só `docker ps/inspect/port` e `SELECT`s) e **não imprime segredos**: valores de ambiente são comparados por SHA-256 com as credenciais de demonstração públicas do upstream e reportados como `DEFAULT DEMO VALUE: container=… variable=…`. Mostra: projeto e arquivos do Compose (`working_dir`, `config_files`), todos os containers e imagens (inclui a versão real do PostgreSQL), portas publicadas, redes compartilhadas com **outros projetos**, volumes do banco e do Storage, configurações não secretas (URLs, cadastro, SMTP), serviços e caminhos do Kong, e `SELECT`s no banco (versão, tamanho, nº de usuários, tabelas públicas sem RLS, buckets, histórico de migrations). Salva em `~/supabase-existing-inspection-<data>.txt` (modo 600). **Me envie esse arquivo**; ele serve para decidir o passo 3 e para confirmar `qarvon_supabase-triatlo-db-1`, o nome exato do container PostgreSQL.

## 3. Risco de persistência: dados dentro do diretório de código do EasyPanel

Relato e evidência: os volumes do banco e do Storage são *bind mounts* de caminhos relativos (`./volumes/...`) que ficam **dentro do diretório que o EasyPanel gerencia** (`working_dir` do Compose, em geral sob `/etc/easypanel/...`). O que isso significa, separando o que é documentado do que é incerto:

| Risco | Base | Situação |
|---|---|---|
| **R1. Destruir/recriar o serviço apaga os arquivos dele**, inclusive esses diretórios | docs do EasyPanel: "Destroying the service permanently removes it and its files" ✅ | certo |
| **R2. Um *deploy* pode re-renderizar ou re-sincronizar o diretório de código** (template reescreve arquivos; fonte Git faz `pull/reset`) e levar `volumes/` junto | docs: o deploy roda `docker compose up --build -d`; **não** documentam se limpam o diretório ⚠️ | **incerto — só o teste dirá** |
| **R3. Backups de volume do EasyPanel podem não cobrir caminhos dentro do código** | docs descrevem backup de volumes *gerenciados* ⚠️ | incerto |
| **R4. Sem cópia fora do servidor** | nenhum backup agendado nesta stack | certo (Q-03) |
| **R5. Troca de credenciais = redeploy**, ou seja, dispara R2 | consequência | **por isso backup + teste vêm antes** |

O script de inspeção (seção 5b da saída) agora coleta a evidência: se o diretório é uma árvore git (redeploy pode rodar `git pull/reset/clean`), quais *bind mounts* de dados caem dentro dele, tamanho, dono/modo, espaço livre, e **a data de criação do `PG_VERSION` comparada à última modificação do compose** (dado mais antigo que o compose ⇒ os dados já sobreviveram a pelo menos uma renderização).

**Mitigação, em ordem (nada disto foi executado):**
1. **Backup lógico + arquivos do Storage + cópia fora do servidor** (§4) antes de qualquer redeploy.
2. **Teste empírico de persistência (portão G1):** `persistence-marker.sh set` → *redeploy sem mudança nenhuma* no EasyPanel → `check`. `PERSISTED` ⇒ um redeploy preserva o banco; `LOST` ⇒ o banco foi reinicializado e restauramos o backup. Como ainda **não há dados pessoais**, é o momento mais barato para descobrir.
3. **Correção definitiva (opcional, exige autorização e janela):** mover os dados para fora do diretório de código (volume nomeado do Docker ou caminho fixo do host): parar o serviço, copiar com `cp -a`, apontar o compose para o novo local, redeploy, `check` do marcador. O diretório original **não é apagado** até validar (reversão = voltar o mount). Eu escrevo os comandos exatos depois de ver a saída da seção 5b, porque dependem do caminho real.

```bash
# G1 (só depois de "autorizo G1"); o marcador é um COMMENT no banco, restaurável com "clear"
bash ~/triatlo-ops/infra/supabase-existing/scripts/persistence-marker.sh set   --db qarvon_supabase-triatlo-db-1
#   ... EasyPanel: redeploy do serviço SEM alterar nada; esperar ficar saudável ...
bash ~/triatlo-ops/infra/supabase-existing/scripts/persistence-marker.sh check --db qarvon_supabase-triatlo-db-1
bash ~/triatlo-ops/infra/supabase-existing/scripts/persistence-marker.sh clear --db qarvon_supabase-triatlo-db-1
```

## 3b. Correção das credenciais demonstrativas — plano coordenado (portão G2)

A inspeção confirmou **demo em vários containers (JWT, PostgreSQL, chaves de API)**, então a correção é **uma janela única e coordenada**: papéis do banco → ambiente → um deploy → verificação. O plano completo, com o mapa de dependências por segredo, ordem, verificação e reversão: **[CREDENTIAL_CORRECTION_PLAN.md](CREDENTIAL_CORRECTION_PLAN.md)**. Base oficial: mudanças no `.env` só valem ao **recriar**; a senha do banco se troca pelo procedimento oficial (inclui `DROP SCHEMA _supavisor CASCADE`, destrutivo para metadados do pooler); rotação de `JWT_SECRET` e das chaves de criptografia **não é documentada** para instâncias já iniciadas. Trio legado compatível com o Kong: `~/.triatlo-secrets/supabase-kong-rotation.env`.

## 4. Backup antes de qualquer alteração (no servidor)

```bash
bash ~/triatlo-ops/infra/supabase-existing/scripts/backup-existing.sh --db qarvon_supabase-triatlo-db-1 [--storage <container-storage>] --out ~/triatlo-backups
bash ~/triatlo-ops/infra/supabase-existing/scripts/restore-rehearsal.sh --db qarvon_supabase-triatlo-db-1 --dump ~/triatlo-backups/existing-db-<UTC>.dump
```

O container do Storage é o serviço Compose `storage` (imagem `supabase/storage-api`); **o nome exato sai da seção 2 da inspeção — não o suponha**; o script recusa qualquer outro. O primeiro gera dump `-Fc` (verificado com `pg_restore --list`), roles e, opcionalmente, os arquivos do Storage, com SHA-256, em pasta 700. O segundo restaura num banco **descartável** `restore_test` dentro do mesmo servidor e o remove (o banco real nunca é tocado). Depois, **copie os arquivos para fora do servidor** (`scp -r <usuario>@<servidor>:~/triatlo-backups ./`): sem isso não existe backup externo (Q-03).

## 5. Status e *dry-run* das 7 migrations (somente leitura — não escrevem nem a tabela de controle)

```bash
cd ~/triatlo-ops && git pull --ff-only
bash supabase/migrate.sh --container qarvon_supabase-triatlo-db-1 --status      # tudo "pending" (nenhuma aplicada)
bash supabase/migrate.sh --container qarvon_supabase-triatlo-db-1 --dry-run     # lista o que seria aplicado
```

O runner recusa o banco se o PostgreSQL for < 15 (as migrations usam `ON DELETE SET NULL (coluna)`), recusa statements destrutivos sem `-- allow-destructive`, e interrompe se um arquivo já aplicado for editado. Verificado em PostgreSQL descartável: `--status` e `--dry-run` deixam o esquema idêntico.

## 6. Aplicar (**só depois da sua autorização explícita**: me diga "aplicar as migrations")

```bash
bash supabase/migrate.sh --container qarvon_supabase-triatlo-db-1               # uma transação por arquivo; checksum registrado
bash supabase/migrate.sh --container qarvon_supabase-triatlo-db-1 --status      # 7 × "applied … checksum ok"
bash supabase/tests/run.sh --production --container qarvon_supabase-triatlo-db-1   # 8 × PASS; tudo revertido; schema auxiliar removido
```

Nenhuma porta do banco é publicada: tudo passa por `docker exec`.

## 7. Conta única e testes por HTTPS (do seu Mac, depois das janelas G2 e G3)

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

## 10. Ordem recomendada, com portões de autorização

1. **Sem autorização (somente leitura):** `git pull` do clone, inspeção corrigida → me enviar a saída (seções 1, 3, 4, 5, 5b, 7, 8).
2. **Backup + cópia fora do servidor + ensaio de restauração** (§4). Escreve apenas arquivos em `~/triatlo-backups` e um banco descartável que é removido.
3. **[G1] Teste de persistência do redeploy** (§3) — marcador + redeploy sem mudanças.
4. Revisão conjunta do plano de credenciais com a saída da inspeção; eu preparo o script de troca de senhas do banco (com o guard).
5. **[G2] Janela de correção das credenciais** ([plano](CREDENTIAL_CORRECTION_PLAN.md)) → verificação → conta única.
6. `migrate.sh --container qarvon_supabase-triatlo-db-1 --status` e `--dry-run` (somente leitura).
7. **[G3] Aplicar as 7 migrations** → `tests/run.sh --production --container …` → testes HTTPS → web.

Nenhum portão é aberto sem o seu "sim" explícito, e cada um exige o verde do anterior.

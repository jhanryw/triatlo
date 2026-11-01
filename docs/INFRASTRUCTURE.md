# INFRASTRUCTURE — Supabase self-hosted, Docker e deploy GitHub → EasyPanel

> Estado: Entrega 0. Nada foi instalado. Itens **[PENDENTE]** exigem informação do usuário sobre o servidor/domínio. ✅ conferido em documentação oficial em 2026-10-31 · ❓ não conferido (conferir antes de executar).

## 1. Dados do servidor que ainda precisamos **[PENDENTE]**

1. Provedor, região, **RAM, vCPU, disco livre** e SO do servidor onde o EasyPanel roda.
2. O EasyPanel já está instalado? Versão? Há outros serviços no mesmo servidor?
3. Domínio/subdomínios disponíveis e quem gerencia o DNS (precisamos de HTTPS: exigência de PWA e Web Push).
4. Destino off-server para backups (bucket S3-compatível, outro servidor, etc.) e orçamento (se pago, requer autorização).
5. Provedor de SMTP para e-mails do Supabase Auth (recuperação de senha, confirmação) — ou decisão de dispensar e-mail.
6. Conta no GitHub (organização ou pessoal) e método de acesso do EasyPanel ao repositório privado.

## 2. Requisitos de recursos

Supabase self-hosted ✅ (doc oficial): mínimo **4 GB RAM / 2 vCPU**, recomendado **8 GB+ / 4+ vCPU**; disco mínimo **40–50 GB SSD** (fontes oficiais divergem: 40 GB na página de docs, 50 GB no repositório), recomendado 80 GB+.

Estimativa de carga adicional **[HIPÓTESE]** (a medir): app web ≈ 0,3–0,5 GB, worker ≈ 0,15–0,3 GB em operação; **build** do Next.js pode exigir ≥ 1–2 GB temporários → o servidor total deve ter folga. Recomendação preliminar: **≥ 8 GB RAM / 4 vCPU / ≥ 80 GB SSD** dedicados a este conjunto, ou build fora do servidor (ver §5).

Serviços Supabase a **omitir inicialmente** ✅ (a doc permite remover Realtime, Storage, imgproxy, Edge Runtime se não usados; analytics/logs são opcionais): **[PROPOSTA]** manter Postgres, Supavisor (ou conexão direta interna), Auth, PostgREST, Storage (necessário p/ fotos), gateway e Studio; omitir Realtime, Edge Runtime/functions, analytics (Logflare/Vector) e, se não houver transformação de imagens, imgproxy. Reavaliar por entrega.

## 3. Como rodar Supabase no EasyPanel

Fatos:
- ✅ Existe template oficial "Supabase" no EasyPanel: cria **um serviço compose** chamado `supabase` (nome configurável), provisiona HTTPS automaticamente; a página indica **última atualização em 2024-07-26** e traz credenciais padrão **explicitamente inseguras** que precisam ser trocadas via variáveis de ambiente. A doc do EasyPanel consultada não lista variáveis, portas nem requisitos.
- ✅ A stack oficial atual do Supabase (repositório `supabase/docker`) mudou: gateway **Envoy** por padrão, chaves nomeadas `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY`, scripts `generate-keys.sh`, `update.sh` (3-way merge), `utils/rotate-new-api-keys.sh` e `utils/db-passwd.sh`; lançamentos estáveis ≈ mensais.
- ✅ A doc oficial pede: **nunca** iniciar com os valores de `.env.example`; reverse proxy com HTTPS na frente; SMTP de produção; guardar segredos em gerenciador de segredos.
- ✅ A doc oficial **não traz procedimento de backup** — dados ficam em `volumes/db/data` e `volumes/storage`; `reset.sh` apaga ambos.

Conclusão: o template do EasyPanel pode estar **defasado** em relação à stack oficial atual. Duas rotas:

| Rota | Descrição | Prós | Contras |
|---|---|---|---|
| **R1 (recomendada para validar)** | Serviço *compose* no EasyPanel usando o `docker-compose.yml` oficial atual do Supabase (versões de imagem fixadas), `.env` gerado por `generate-keys.sh` | Stack atual e suportada; atualizações documentadas | Precisa confirmar que a versão do EasyPanel suporta serviço compose com arquivo próprio ❓ e adaptar domínios/volumes |
| R2 | Template do EasyPanel | Rápido | Possível defasagem; menos controle; credenciais padrão |

Decisão **[PENDENTE]** (P-05): executar um *spike* de 1–2 h na Entrega 1 (fora de produção) para confirmar qual rota funciona no servidor real.

### Rede, exposição e portas
- Exposto publicamente apenas por HTTPS via proxy do EasyPanel: **app web** (`app.<domínio>`) e **API do Supabase** (`api.<domínio>`; necessária para o navegador usar Auth/Storage).
- **Studio** restrito: Basic Auth no domínio ✅ (EasyPanel suporta) + senha forte, ou não expor e acessar por túnel SSH.
- **Postgres (5432/6543) não exposto à internet.** O worker conecta pela rede interna.
- Worker **sem domínio público**; saúde por heartbeat no banco e/ou endpoint interno.

### Segredos do Supabase (gerados na instalação, nunca no Git)
`POSTGRES_PASSWORD`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (ou, em versões legadas, `ANON_KEY`/`SERVICE_ROLE_KEY`/`JWT_SECRET`), `DASHBOARD_PASSWORD`, `SECRET_KEY_BASE`, `REALTIME_DB_ENC_KEY`, `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY`, chaves de S3/MinIO se usadas, URLs (`SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL`) e SMTP. Nomes exatos devem ser conferidos contra a versão instalada.

### Auth em self-hosted **[PROPOSTA]**
Desativar cadastro público; criar a conta única administrativamente; considerar MFA/TOTP ❓ (conferir suporte na versão); definir `SITE_URL`/redirects restritos ao domínio do app.

## 4. Variáveis de ambiente por serviço **[PROPOSTA]**

| Variável | web | worker | Observação |
|---|:--:|:--:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✔ (build+run) | – | URL pública da API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ou `…ANON_KEY`) | ✔ (build+run) | – | Chave pública; só funciona com RLS |
| `SUPABASE_SECRET_KEY` | ✖ (evitar) | ✔ | **Privilegiada** — nunca `NEXT_PUBLIC_`, nunca no repo |
| `DATABASE_URL` (papel dedicado do worker) | – | ✔ | Rede interna |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ✔ (build) | ✔ | Pública |
| `VAPID_PRIVATE_KEY` | ✖ | ✔ | Privada |
| `VAPID_SUBJECT` (`mailto:`) | – | ✔ | |
| `APP_BASE_URL` | ✔ | ✔ | Links nas notificações |
| `APP_TIMEZONE_DEFAULT` | ✔ | ✔ | Fuso padrão; o fuso real fica no perfil |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_DAILY_BUDGET`, `AI_ENABLED` | opcional | ✔ | **Somente após** definir dados enviados (Entrega 5/6) |
| `WORKER_TICK_SECONDS`, `LOG_LEVEL` | – | ✔ | |

Regras: `.env*` no `.gitignore` (já criado); `.env.example` só com chaves e placeholders (Entrega 1); segredos reais só no EasyPanel ✅ (variáveis ficam disponíveis no build e no runtime, e a doc as trata como segredos); CI com varredura de segredos.

⚠️ Armadilha: `NEXT_PUBLIC_*` é embutido no bundle no *build*. Trocar a URL/chave exige **novo build**.

## 5. Docker e deploy GitHub → EasyPanel **[PROPOSTA]**

Fatos do EasyPanel ✅ (serviço *App*): fonte GitHub (`owner/repo`, branch, caminho de build) com token do servidor para repositório privado, ou fonte Git genérica com *deploy key* SSH somente leitura; tipos de build **Dockerfile**, Buildpacks, Nixpacks, Railpack; **auto deploy** por webhook de push; **Deployment Trigger URL** para chamadas de CI; domínios com HTTPS, porta de destino, Basic Auth; limites de CPU/memória (reserva e teto); volumes gerenciados com **backups agendados de volume** para provedor de armazenamento; réplicas, zero-downtime, healthcheck não coberto na página consultada ❓.

Estratégia:
1. **Dois serviços App** a partir do mesmo repositório: `triatlo-web` e `triatlo-worker`, ambos com contexto de build na raiz (`/`) e Dockerfiles distintos (`apps/web/Dockerfile`, `apps/worker/Dockerfile`). Monorepo exige contexto na raiz para enxergar `packages/*`.
2. **Dockerfiles multi-stage**: (a) instalar dependências com *lockfile* congelado; (b) build; (c) imagem final mínima, usuário não-root, `NODE_ENV=production`, somente artefatos necessários (`standalone` para o web). Imagem base com versão **fixada** (LTS do Node escolhido).
3. **Healthchecks**: web `GET /api/health` (sem dados sensíveis); worker com heartbeat em tabela + log estruturado.
4. **Migrações não rodam no boot do app.** Aplicadas por passo explícito (CLI/CI) antes do deploy, com backup prévio — evita migração destrutiva acidental. Ferramenta: P-07 **[PENDENTE]** (Supabase CLI `db push --db-url` ❓ ou runner SQL simples).
5. **Gatilho de deploy**: push na `main` → webhook → build no EasyPanel. Alternativa se o build estourar memória: GitHub Actions constrói a imagem e publica em registry privado; EasyPanel usa fonte *Docker Image* ✅ (tag/digest fixos). Decisão: após medir o primeiro build (Entrega 1).
6. **Ambientes**: local + produção. Ambiente de *staging* **[PENDENTE]** (P-12) — custo de recursos vs. segurança; mínimo viável é testar migrações num Postgres descartável no CI.
7. **Rollback**: manter imagens/tags anteriores; migrações *forward-only* com passos de reversão documentados quando aplicável.
8. **Réplicas**: web pode ter 1 réplica (uso pessoal); **worker exatamente 1** (embora `SKIP LOCKED` tolere mais, evita duplicidade acidental).

## 6. Backup e recuperação (resumo; procedimento completo em QUALITY_SECURITY.md)

- Postgres: `pg_dump` lógico agendado (diário) + retenção; opcionalmente base backup/WAL ❓ se o RPO exigir.
- Storage (fotos): volume `volumes/storage` (ou bucket S3 externo) com backup agendado ✅ (EasyPanel permite backup de volume).
- Configuração: exportar `.env` do Supabase e do app para cofre de segredos fora do servidor.
- Destino **fora do servidor** obrigatório. **Teste de restauração** trimestral e antes de cada atualização maior do Supabase.
- RPO/RTO alvo **[PENDENTE]** (sugestão: RPO ≤ 24 h, RTO ≤ 1 dia, por ser uso pessoal).

## 7. Checklist de pré-requisitos antes de instalar o Supabase

- [ ] Especificação do servidor confirmada (§1) e ≥ 8 GB RAM livres planejados
- [ ] Domínio/DNS definidos; certificados HTTPS emitidos pelo EasyPanel
- [ ] Rota R1 ou R2 decidida (P-05)
- [ ] Segredos gerados (scripts oficiais) e guardados em cofre fora do servidor
- [ ] Destino de backup definido e acessível
- [ ] SMTP definido ou dispensa registrada
- [ ] Repositório GitHub privado criado e acesso do EasyPanel (token/deploy key) configurado
- [ ] Docker instalado na máquina de desenvolvimento (ou decisão alternativa P-11)

## 8. Estado após a Entrega 1

Dockerfiles (`apps/web/Dockerfile`, `apps/worker/Dockerfile`), `.dockerignore` e o workflow `.github/workflows/ci.yml` foram escritos conforme §5, **sem execução** (sem Docker local, sem remoto GitHub). Passo a passo de deploy e verificação pós-deploy: [DEPLOYMENT.md](DEPLOYMENT.md). Supabase **não foi instalado** (A-20).

## 9. Supabase para o EasyPanel
> **Atualização A-24 (2026-10-31):** a produção usa a **instalação existente (Kong)**; a stack Envoy descrita abaixo é só referência. Roteiro vigente: [SUPABASE_EXISTING.md](SUPABASE_EXISTING.md).

A stack foi escolhida e adaptada (versão fixada `self-hosted/v0.8.3`, sem portas publicadas, volumes nomeados, backup). Procedimento exato, tabela de variáveis e verificações: [SUPABASE_EASYPANEL.md](SUPABASE_EASYPANEL.md). Esta seção substitui o que §3 dizia sobre rotas R1/R2: **a rota R1 (Compose por Git com o compose oficial atual) foi adotada**; a validação no servidor real continua pendente (Q-18).

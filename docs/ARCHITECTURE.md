# ARCHITECTURE — Triatlo Inteligente

> Estado: Entrega 0. Tudo aqui é **[PROPOSTA]** salvo onde marcado **[APROVADO]**. Legenda de verificação de fatos externos: ✅ conferido em documentação oficial em 2026-10-31 · ⚠️ fonte parcial/não oficial · ❓ conhecimento prévio, não conferido nesta sessão (conferir antes de implementar).

## 1. Visão geral

```
                    iPhone (PWA instalada) / Desktop
                               │ HTTPS
                  ┌────────────▼─────────────┐
                  │  apps/web  (Next.js)      │  UI, Server Actions/Route Handlers,
                  │  container "web"          │  autenticação (cookies), assinatura push
                  └───────┬──────────┬────────┘
                          │          │ enfileira jobs / lê estado
        Supabase API      │          │
   (Auth, REST, Storage)  │   ┌──────▼──────────────────┐
                          │   │ apps/worker (Node)       │  scheduler + executor de jobs,
                          │   │ container "worker"       │  envio Web Push, motor adaptativo
                          │   └──────┬──────────────────┘
                  ┌───────▼──────────▼───────┐
                  │ Supabase self-hosted      │  PostgreSQL + RLS, Auth, Storage privado
                  │ (stack dedicada, rede     │
                  │  interna do EasyPanel)    │
                  └──────────────────────────┘
        Saídas controladas do worker: push services (Apple/FCM/Mozilla), provedor de IA (futuro)
```

**[APROVADO]** Next.js + TypeScript + Tailwind; Supabase self-hosted e dedicado (PostgreSQL, Auth, Storage privado); PWA com Web Push; worker dedicado para notificações e análises agendadas; GitHub privado + deploy pelo EasyPanel; motor adaptativo com regras determinísticas e autonomia híbrida; Amazfit Active 2 como única fonte esportiva externa, condicionada a integração autorizada.

## 2. Estrutura do repositório **[PROPOSTA]**

```
triatlo/
├── apps/
│   ├── web/            Next.js (App Router), PWA, UI. Nunca contém segredos privilegiados.
│   └── worker/         Processo Node de longa duração: scheduler, jobs, push, motor.
├── packages/
│   ├── shared/         Tipos, schemas de validação, constantes, contratos (job payloads, DTOs).
│   └── domain/         Lógica pura e determinística (regras, tendências, validações do motor).
│                       Sem I/O, sem acesso a rede/DB → 100% testável por unidade.
├── supabase/
│   ├── migrations/     SQL versionado (única fonte de verdade do schema).
│   ├── tests/          Testes SQL/RLS (pgTAP ou equivalente).
│   └── seed/           Somente dados de teste/dev, nunca aplicados em produção.
├── infra/
│   ├── local/          Ambiente de desenvolvimento local (Postgres/Supabase de dev).
│   └── backup/         Scripts e runbooks de backup/restauração.
├── docs/               Documentação viva.
├── .github/workflows/  CI (lint, tipos, testes, build, varredura de segredos).
└── CLAUDE.md
```

Racional da separação:
- `domain` isolado do Next.js e do worker garante que **a mesma regra** valide uma alteração tanto no app (pré-visualização) quanto no worker (aplicação), e que seja testável sem banco.
- `worker` separado do `web` porque timers dentro de processo serverless/aberto no navegador não são confiáveis, e o reinício do `web` (deploy) não deve interromper jobs.
- `supabase/migrations` na raiz segue a convenção da CLI do Supabase e mantém o schema fora do código de aplicação.

Gerenciador de workspaces: ver P-03 em [DECISIONS.md](DECISIONS.md) (npm vs pnpm; **[PENDENTE]**).

## 3. Componentes

### 3.1 `apps/web`
- Next.js ✅ (docs atuais descrevem Next.js 16; exige Node ≥ 20.9; `create-next-app` padrão ativa TypeScript, Tailwind, ESLint, App Router e Turbopack; `next build` não executa mais o linter, então lint roda como script/CI).
- Autenticação via `@supabase/ssr` (cookies httpOnly) ❓ — conferir API atual na Entrega 2.
- Validação de permissões no servidor em **toda** Server Action/Route Handler; RLS como segunda barreira.
- Service Worker artesanal e mínimo (push + clique); cache offline avançado **fora de escopo** inicial (Serwist é opção futura ✅ citada na doc do Next.js).
- `output: 'standalone'` para imagem Docker enxuta ❓ (confirmar interação com monorepo/`outputFileTracingRoot` na Entrega 1).
- Variáveis `NEXT_PUBLIC_*` são embutidas no build ❓ → precisam existir como *build args/variáveis de build* no EasyPanel (✅ variáveis do EasyPanel ficam disponíveis no build e no runtime).

### 3.2 `apps/worker`
Processo Node único (uma réplica) com três responsabilidades:
1. **Scheduler**: a cada tick (ex.: 30–60 s, configurável) materializa jobs devidos (check-ins, lembretes, reavaliação diária) a partir de sessões, refeições e preferências, respeitando fuso do usuário.
2. **Executor de jobs**: reivindica jobs pendentes com `SELECT … FOR UPDATE SKIP LOCKED`, executa handlers idempotentes, registra resultado.
3. **Motor adaptativo (Entrega 6)**: handler `adapt.evaluate` que roda a pipeline determinística (§6).

Conexão: Postgres direto pela rede interna (credencial de papel dedicado, não a chave pública) ou API com chave secreta do Supabase; escolha **[PENDENTE]** (P-08). A chave privilegiada **nunca** vai ao frontend nem ao repositório.

### 3.3 Supabase self-hosted
> **Atualização (A-24, 2026-10-31):** em produção usamos a **instalação existente baseada em Kong** (não a stack Envoy de `infra/supabase`, que ficou como referência). Ver §12.

Ver [INFRASTRUCTURE.md](INFRASTRUCTURE.md). Resumo: stack oficial em Docker ✅ (Studio, gateway Envoy por padrão com Kong opcional, Auth, PostgREST, Realtime, Storage, imgproxy, postgres-meta, Edge Runtime, Postgres + Supavisor; Logflare/Vector opcionais). Mínimo oficial 4 GB RAM / 2 vCPU; recomendado 8 GB+ / 4+ vCPU ✅. Serviços não usados (Realtime, Edge Runtime, imgproxy, analytics) podem ser removidos para economizar recursos ✅ — **[PROPOSTA]** iniciar enxuto.

## 4. Fila e processamento de jobs **[PROPOSTA]**

Requisitos do usuário: fila persistente, idempotência, reprocessamento após falha/reinício, UTC + fuso configurável, observabilidade, nada dependente de página aberta.

### 4.1 Opções avaliadas
| Opção | Prós | Contras |
|---|---|---|
| **A. Tabela própria `jobs` + `SKIP LOCKED`** (recomendada) | Zero dependência nova; controle total de idempotência, supersessão (cancelar jobs antigos ao reagendar), auditoria e métricas; migrações no mesmo fluxo SQL | Escrever e testar o executor (pequeno) |
| B. pgmq / Supabase Queues ✅ (entrega "exactly once" dentro da janela de visibilidade; arquivamento; integra com RLS) | Pronto, mantido pelo Supabase | Disponibilidade/operação em self-hosted **não confirmada** na doc consultada; modelo genérico, sem noção de supersessão por entidade |
| C. Biblioteca de fila sobre Postgres (ex.: pg-boss) ❓ | Maduro | Dependência extra com schema próprio; avaliar manutenção/licença antes de adotar |
| D. `pg_cron` disparando HTTP/funções | Simples para periódicos | Pouca visibilidade de falhas, não resolve reprocessamento por evento |

Recomendação: **A**, com contrato de job simples. Decisão formal pendente (P-04).

### 4.2 Contrato de job (conceitual — o DDL fica para a Entrega 2/4)
Campos: `id`, `type`, `user_id`, `payload` (JSON validado por schema em `packages/shared`), `run_at` (UTC), `status` (`pending|claimed|succeeded|failed|dead|cancelled|superseded`), `attempts`, `max_attempts`, `locked_until`/`claimed_by`, `idempotency_key` (único), `source_ref` (entidade que originou, ex.: `session:<id>@v<n>`), `last_error`, timestamps.

Regras:
- **Idempotência**: `idempotency_key = tipo:usuário:entidade:versão:janela`. Inserção duplicada é no-op.
- **Supersessão**: reagendar/alterar uma sessão cancela jobs `pending` cujo `source_ref` aponte para a versão anterior e cria novos. Isso atende "atualizar ou cancelar notificações antigas".
- **Retentativas**: backoff exponencial com teto e `max_attempts`; esgotado → `dead` (visível na observabilidade, nunca silencioso).
- **Reinício**: jobs `claimed` com lease expirada voltam a `pending`.
- **Tempo**: tudo em UTC; o fuso IANA do usuário vive no perfil e é usado só para *calcular* `run_at` e janelas (sono, silêncio). Atenção a mudanças de horário de verão/viagem ❓ (testar em Entrega 8).
- **Observabilidade**: tabela de execuções/entregas, heartbeat do worker, endpoint de saúde, logs estruturados sem dados sensíveis. Métricas mínimas: jobs por status, idade do job pendente mais antigo, falhas por tipo.

## 5. Web Push e PWA **[PROPOSTA]**

Fatos verificados ✅ (WebKit e docs do Next.js):
- iOS/iPadOS ≥ 16.4: Web Push só para **web apps adicionados à Tela de Início**, com manifest `display: standalone|fullscreen`.
- A permissão deve ser solicitada **em resposta a interação direta** (ex.: botão "Ativar notificações"); depois o iOS mostra o próprio prompt. Isso casa com o requisito do usuário.
- Entrega via APNs, sem conta de desenvolvedor paga; se houver controle de egress, liberar `*.push.apple.com`.
- Modos de Foco do iOS afetam notificações; o usuário gerencia permissão por web app.
- HTTPS obrigatório; Safari 16.4+ é o piso suportado pelo Next.js ✅.

Plano:
1. `app/manifest.ts` (ou JSON) com `id`, ícones 192/512 + `apple-touch-icon`, `display: standalone`, cores.
2. Tela de Configurações → Notificações com: explicação de instalação no iPhone, botão que chama `Notification.requestPermission()` + `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, registro do consentimento (data, user agent, versão do texto) e botão de desativar.
3. Tabela de assinaturas (endpoint, chaves, user_id, estado, último sucesso/erro). Respostas 404/410 do push service → desativar assinatura.
4. Envio **somente pelo worker** com a lib `web-push` ✅ (usada na doc oficial do Next.js), chaves VAPID em segredos do servidor. Chave privada VAPID nunca no `web`.
5. Payload mínimo (título curto, corpo, `url`, `tag` para colapsar/atualizar) — conteúdo de saúde sensível não vai no payload de push.
6. Limites de frequência, horário de sono e preferências aplicados **antes** de criar o envio (no planejamento) e rechecados no envio.
7. Teste de ponta a ponta em iPhone real (simulador não valida push) — item de aceite da Entrega 4.

Riscos conhecidos: entrega do iOS não é garantida (Foco, economia de energia, PWA removida/reinstalada gera nova assinatura). Mitigação: central de notificações dentro do app + status de entrega registrado; push é conveniência, não canal crítico.

## 6. Motor adaptativo — execução diária e por eventos **[PROPOSTA — documentação do mecanismo]**

Nenhuma regra quantitativa existe ainda; **limites de progressão, redução e intensidade são [PENDENTE]** e o motor nasce em modo *observação/proposta*, com ações automáticas desativadas por *feature flag* até aprovação (P-09).

### 6.1 Camadas (cada uma testável isoladamente)
1. **Ingestão e qualidade de dados** — normaliza check-ins, sessões realizadas, sono/FC/HRV (quando houver), refeições; atribui `quality` (completo, parcial, ausente, conflitante). Ausência é estado explícito, não zero.
2. **Cálculos determinísticos** (`packages/domain`) — somatórios de carga/volume, médias móveis, tendências, aderência. Cada fórmula exige referência e limites documentados antes de entrar (BUSINESS_RULES.md).
3. **Regras de segurança (guardrails)** — vetos duros: p.ex., "dados insuficientes ⇒ nenhuma progressão"; "sintoma subjetivo relevante não é anulado por métrica do relógio". Os valores numéricos vêm de configuração aprovada, não de código ad hoc.
4. **Decisão** — produz *propostas tipadas*: `auto_safe` (reorganizar horário, reduzir dentro de limite aprovado), `needs_approval` (aumento de carga/intensidade), `structural` (mudança de fase/periodização). Cada proposta carrega justificativa, dados usados, qualidade, regra aplicada e versão do plano de origem.
5. **Interpretação generativa (opcional, Entrega 6+)** — LLM apenas *explica* e sugere redação/perguntas; **não** cria nem aplica alterações; saída validada contra schema; sem dados pessoais além do configurado e informado.
6. **Aplicação** — transação: valida novamente (guardrails + estabilidade) → grava nova versão do plano → registra auditoria → cria/cancela jobs de notificação → permite *undo* (restaurar versão anterior como nova versão).

### 6.2 Gatilhos
- **Diário**: job `adapt.daily` por usuário, agendado na janela local pós-despertar. Se o dado de sono ainda não chegou, reagenda dentro de uma janela e, no fim dela, avalia como "dados insuficientes" (sem progressão). Os horários/janelas são **[PENDENTE]**.
- **Por evento**: treino concluído/parcial, mudança de disponibilidade, check-in com relato relevante, nova importação de dados. Cada evento enfileira `adapt.evaluate` com chave de idempotência por usuário+janela (*coalescência*: vários eventos próximos geram uma avaliação). Duração da janela **[PENDENTE]**.
- **Estabilidade**: versão monotônica do plano; intervalo mínimo entre alterações da mesma sessão e proibição de alterações contraditórias consecutivas (histerese). Valores **[PENDENTE]**.

### 6.3 Conflito subjetivo × relógio
Avaliar magnitude da divergência, qualidade do dado e histórico recente; relato relevante nunca é descartado por métrica "boa". Regra exata: BUSINESS_RULES.md (a escrever e aprovar antes da Entrega 6).

### 6.4 Controle de custo e privacidade da IA
Orçamento diário/mensal e teto de chamadas configuráveis, cache por hash de entrada, registro de cada chamada (modelo, tokens, finalidade, quais campos foram enviados). Fotos de refeição só são enviadas à IA após consentimento explícito e configuração visível em Configurações → IA.

## 7. Modelo de dados e segurança (resumo; detalhes em DATABASE_SCHEMA.md, Entrega 2)

- Toda tabela de dados do usuário tem `user_id uuid not null default auth.uid()` e RLS habilitada com política "dono apenas". Mesmo com uso individual, mantém-se o isolamento porque RLS é a defesa contra erro de código e contra vazamento da chave pública.
- Storage: bucket **privado**, caminho `{user_id}/…`, políticas por prefixo, acesso por URL assinada de curta duração.
- Cadastro público **desativado**; a única conta é criada administrativamente (P-06).
- Auditoria: tabela append-only de alterações automáticas e de aplicação/undo.
- Exportação (JSON/CSV + fotos) e exclusão (por registro e total) como funcionalidades de primeira classe.

Estratégia completa de testes/RLS/backup: [QUALITY_SECURITY.md](QUALITY_SECURITY.md).

## 8. Dependências candidatas (versões fixadas só na Entrega 1)

| Dependência | Uso | Observação |
|---|---|---|
| next, react, react-dom | App | Next 16.x ✅ exige Node ≥ 20.9; fixar versão exata via `npm view` na Entrega 1 |
| typescript | Tipagem | ≥ 5.1 ✅ |
| tailwindcss | Estilo | Padrão do `create-next-app` ✅ |
| @supabase/supabase-js, @supabase/ssr | Cliente/Auth SSR | ❓ conferir API atual |
| web-push | VAPID/envio | ✅ citado na doc do Next.js; roda só no worker |
| zod (ou equivalente) | Validação de contratos | ❓ avaliar |
| pg / postgres.js | Worker → Postgres | ❓ escolher uma |
| vitest | Testes unitários/integração | ❓ |
| playwright | E2E | ❓ |
| eslint (+ prettier ou biome) | Qualidade | ✅ ESLint ou Biome suportados |
| serwist | Offline/SW avançado | **Não** incluir agora |
| Node.js | Runtime | Máquina local: v22.16.0, npm 10.9.2. Escolher LTS vigente para a imagem Docker e fixar em `.nvmrc`/`engines` ❓ |

Ferramentas locais verificadas nesta sessão: `node v22.16.0`, `npm 10.9.2`, `git 2.50.1`; **Docker não está instalado** nesta máquina (relevante para testes locais com Supabase/Postgres — ver P-11).

## 9. Riscos

| # | Risco | Impacto | Mitigação proposta |
|---|---|---|---|
| R1 | Operar Supabase self-hosted num único servidor (upgrades mensais, backups, segurança) | Perda de dados / indisponibilidade | Runbook de backup com teste de restauração; versões fixadas; atualizações planejadas; monitorar disco |
| R2 | Template Supabase do EasyPanel pode estar defasado (página indica última atualização em 2024-07-26 e senha padrão insegura) ✅ | Stack antiga/insegura | Preferir stack oficial atual (compose) fixada por versão; trocar todos os segredos; validar na Entrega 1 |
| R3 | Servidor subdimensionado (Supabase 4–8 GB + web + worker + builds Next) | Quedas, OOM no build | Medir antes; builds com limite de memória adequado; considerar build em CI e deploy por imagem |
| R4 | Sem API pública do Amazfit comprovada | Entrega 7 bloqueada | Importação manual estruturada primeiro; abstração de fonte; spike de validação (INTEGRATIONS.md) |
| R5 | Web Push no iOS depende de instalação, permissão e Foco | Lembretes não chegam | Inbox in-app, status de entrega, expectativas documentadas |
| R6 | LLM produzindo recomendação esportiva/nutricional de risco | Dano à saúde | Camadas determinísticas + guardrails; LLM só explica; flags desligadas por padrão |
| R7 | Limites quantitativos ainda não aprovados | Motor não pode agir | Modo proposta; bloquear automações até aprovação |
| R8 | Dados de saúde enviados a terceiros (IA, agregadores) | Privacidade | Minimização, consentimento por categoria, log de envio, provedor configurável |
| R9 | Chave privilegiada exposta (repo/frontend) | Acesso total | Segredos só em EasyPanel; varredura de segredos no CI; chave secreta só no worker/servidor |
| R10 | Duplicidade de eventos/notificações | Spam, decisões repetidas | Idempotência por chave, supersessão, testes de concorrência |
| R11 | Fuso/horário de verão/viagem | Lembretes no horário errado | UTC + IANA; testes de DST/viagem |
| R12 | Ponto único de falha (um servidor) | Indisponibilidade | Aceito para uso pessoal; backup off-server obrigatório |
| R13 | Custo (IA, armazenamento de backup, SMTP) | Gastos não autorizados | Nenhum serviço pago sem autorização; orçamento de IA |

## 10. O que esta arquitetura deliberadamente NÃO faz agora

Sem RLS/tabelas, sem treinos, sem recomendações nutricionais, sem Amazfit, sem chamadas de IA, sem Supabase instalado, sem código de aplicação.

## 11. Estado de implementação após a Entrega 1 (2026-10-31)

Implementado localmente conforme as seções acima, com estas particularidades:

| Item | Estado |
|---|---|
| Monorepo npm workspaces (`apps/web`, `apps/worker`, `packages/shared`, `packages/domain`) | ✅ implementado (A-16, A-19) |
| `packages/shared` / `packages/domain` exportam fontes TS; worker empacotado por esbuild em `main.mjs` | ✅ (P-19) |
| Modelo de planos versionados, propostas, aprovações, justificativas, auditoria | ✅ contratos + funções puras + testes — **sem critérios esportivos** ([DOMAIN_MODEL.md](DOMAIN_MODEL.md)) |
| App web: 6 seções, estados vazios, `DemoCard` identificado, tema claro/escuro, safe-area iPhone | ✅ |
| PWA: manifest `standalone`, ícones (192/512/maskable/apple-touch), `sw.js` sem cache | ✅ preparado; registro real não verificado no navegador embutido |
| Web Push: capacidade/estados, fluxo de ativação por clique, consentimento, stub `501` | ✅ **inativo** por padrão (P-21) |
| Cliente Supabase (browser/server, chave pública), sem servidor | ✅ preparado; app funciona sem ele |
| Worker: config, logs JSON, loop sequencial, `/healthz` | ✅ esqueleto; **sem banco, sem jobs, sem push, sem motor** |
| Dockerfiles (web/worker), `.dockerignore` | ⚠️ escritos, **não executados** (sem Docker local) |
| GitHub Actions (quality 22/24, security, docker smoke) | ⚠️ escrito, **nunca executado** (sem remoto) |
| `scripts/security-check.mjs` (arquivos/valores secretos, credenciais privilegiadas no web e nos bundles) | ✅ testado manualmente com caso negativo |

### Versões fixadas (resolvidas com `npm view` em 2026-10-31)
`next 16.4.3`, `react/react-dom 19.3.1`, `tailwindcss/@tailwindcss/postcss 4.3.3`, `typescript 5.9.3` (P-17), `eslint 9.39.5` + `eslint-config-next 16.4.3` (P-17), `vitest 5.0.5`, `zod 4.6.7`, `@supabase/supabase-js 2.118.0`, `@supabase/ssr 0.12.7`, `esbuild 0.28.2`, `tsx 4.23.15`, `@types/node 22.20.5`. Imagem Docker: `node:24.22.2-slim` (tag verificada no Docker Hub). `web-push` **não** foi instalado (entra na Entrega 4, apenas no worker).

### Decisões de implementação a registrar
- `next build` já não roda lint (Next 16 ✅); lint é script próprio. `middleware` foi renomeado `proxy` no Next 16 ❓ — nenhuma sessão é gerenciada ainda; avaliar na Entrega 2.
- CSP restritiva e verificação de sessão no servidor ficam para a Entrega 2 (precisa de nonces e de Auth).

## 12. Supabase em produção: a instalação existente (Kong) — decisão A-24

**Decisão:** manter o Supabase self-hosted atual do EasyPanel (`qarvon-supabase-triatlo…`): gateway Kong 3.9.1, GoTrue v2.186.0, PostgREST 14.8, PostgreSQL provavelmente 15 (a confirmar). Nenhuma instância nova, nenhuma troca de gateway, nenhum volume ou dado recriado.

```
Navegador/PWA ──HTTPS──► web (Next.js)                     usa só a chave PÚBLICA: anon JWT legado
      │                      │
      └──HTTPS (apikey = anon JWT + sessão do usuário)──► Kong ─► Auth (GoTrue) · REST (PostgREST + RLS) · Storage (bucket privado)
                                                          │
worker (futuro) ──HTTPS (SERVICE_ROLE_KEY, só backend)────┘            PostgreSQL: sem porta publicada (verificado de fora)
```

- **Chaves:** o Kong compara o `apikey` com `ANON_KEY`/`SERVICE_ROLE_KEY` (JWT HS256 assinados com `JWT_SECRET`). Só o trio legado é compatível; chaves opacas/assimétricas são da stack de referência e não se usam aqui.
- **Estado de segurança conhecido:** `JWT_SECRET` padrão público em uso até a fase 1 de P-34 (credenciais). O app **recusa** chaves de demonstração e privilegiadas.
- **Persistência:** as 7 migrations (RLS em todas as tabelas) serão aplicadas ao PostgreSQL existente com `migrate.sh --container <db>` após backup e autorização; testes SQL em modo `--production` (transação revertida) e testes HTTPS.
- **Sem mudanças no desenho do app:** o cliente Supabase apenas aceita o nome `…ANON_KEY` além de `…PUBLISHABLE_KEY` e lê a configuração em runtime.
- **Limitações da stack Kong atual:** sem backups agendados (a stack de referência tinha); `/functions/v1` responde sem chave por desenho do upstream; rotação de chaves de criptografia não documentada.
- **Banco identificado como serviço Compose `db`** (`qarvon_supabase-triatlo-db-1`, confirmado em 2026-10-31); `…-meta-1` é o postgres-meta. Toda ferramenta operacional valida isso (`supabase/lib/db-guard.sh`) antes de escrever.
- **Persistência:** os volumes estão em *bind mounts* dentro do diretório de código do EasyPanel (risco documentado e plano de mitigação em SUPABASE_EXISTING §3).
- **Operação:** [SUPABASE_EXISTING.md](SUPABASE_EXISTING.md) · credenciais: [CREDENTIAL_CORRECTION_PLAN.md](CREDENTIAL_CORRECTION_PLAN.md).

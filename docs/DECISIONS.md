# DECISIONS — Registro de decisões

> Última atualização: 2026-10-31 (Entrega 1 — fundação executável, local). Regra: **nenhuma decisão é movida para "Aprovadas" sem confirmação explícita do usuário.** Quando uma proposta for aprovada, registre data e origem e mova-a.

## A. Decisões APROVADAS pelo usuário

| ID | Decisão | Origem |
|---|---|---|
| A-01 | App pessoal, uso exclusivo de uma pessoa; sem multiempresa e sem monetização | Prompt mestre |
| A-02 | Stack: Next.js (App Router) + TypeScript + Tailwind | Prompt mestre / mensagem de arquitetura |
| A-03 | Backend de dados: **Supabase self-hosted e dedicado** (PostgreSQL, Auth, Storage privado) | Mensagem de arquitetura |
| A-04 | PWA instalável (iPhone prioritário + desktop) com Web Push (VAPID) | Prompt mestre |
| A-05 | **Worker dedicado** para notificações e análises agendadas | Mensagem de arquitetura |
| A-06 | Repositório privado no GitHub; deploy pelo EasyPanel (Docker) | Prompt mestre / mensagem |
| A-07 | IA multimodal configurável por provedor, inicialmente OpenAI | Prompt mestre |
| A-08 | Motor adaptativo com regras determinísticas; **LLM não é o único decisor**; autonomia híbrida (ajustes seguros automáticos; aumentos e mudanças estruturais com aprovação) | Prompt mestre |
| A-09 | Amazfit Active 2 é a **única** fonte esportiva; sem Strava/Garmin/Polar/COROS; sem scraping/engenharia reversa | Prompt mestre |
| A-10 | Permissão de push só após ação explícita do usuário; sem lembretes excessivos/culpabilizantes | Prompt mestre |
| A-11 | Sem gamificação punitiva, sequências obrigatórias, culpa ou metas de restrição alimentar; treino perdido não é penalizado nem acumulado | Prompt mestre |
| A-12 | Não ativar progressões automáticas antes da aprovação de limites quantitativos | Prompt mestre |
| A-13 | Trabalho por entregas pequenas e verificáveis (0→8); Entrega 1 só após aprovação do plano | Prompt mestre |
| A-14 | Conjunto de documentos do projeto conforme a lista do prompt mestre | Prompt mestre |
| A-15 | Arquitetura da Entrega 0 aprovada conceitualmente; Entrega 1 autorizada para desenvolvimento **local** | Mensagem de 2026-10-31 (revisão da Entrega 0) |
| A-16 | Gerenciador de pacotes: **npm workspaces** (ex-P-03) | Mensagem de 2026-10-31 |
| A-17 | Docker local **não é obrigatório**; build Docker e testes de integração rodam no **GitHub Actions** (ex-P-11) | Mensagem de 2026-10-31 |
| A-18 | Código, tabelas, APIs e nomes técnicos em **inglês**; interface e mensagens ao usuário em **pt-BR** (ex-P-13) | Mensagem de 2026-10-31 |
| A-19 | Monorepo com `apps/web`, `apps/worker`, `packages/shared`, `packages/domain` (ex-P-01) | Mensagem de 2026-10-31 |
| A-20 | Supabase self-hosted dedicado no EasyPanel, **sem instalar** até validar a capacidade do VPS | Mensagem de 2026-10-31 |
| A-21 | ~~Repositório privado~~ — **visibilidade revista por A-23**. Mantém-se: não fazer push sem autorização (concedida em 2026-10-31 para `main` do repositório abaixo, sem force push) | Mensagem de 2026-10-31 |
| A-23 | O repositório https://github.com/jhanryw/triatlo.git **pode permanecer público** (decisão do proprietário, 2026-10-31). Consequências: nunca versionar segredos/dados pessoais (varredura obrigatória no CI); a configuração de infraestrutura fica pública (sem credenciais); o EasyPanel clona sem deploy key/token | Mensagem de 2026-10-31 |
| A-22 | Versões fixadas e lockfile versionado | Mensagem de 2026-10-31 |
| A-24 | **Manter a instalação atual do Supabase self-hosted no EasyPanel** (`https://qarvon-supabase-triatlo.uxxkgy.easypanel.host`, gateway **Kong**). Não criar outra instância, não trocar Kong por Envoy, não reconstruir. Preservar containers, volumes e dados; não alterar serviços de outros projetos; sem mudanças destrutivas nem troca de credenciais sem autorização | Mensagem de 2026-10-31 (decisão de infraestrutura) |

## B. PROPOSTAS (aguardam aprovação)

| ID | Proposta | Alternativas | Recomendação / Observação |
|---|---|---|---|
| P-01 | ~~Monorepo~~ → **aprovada como A-19** | — | — |
| P-02 | Node para imagens Docker e CI: **24 (`node:24.22.2-slim`)**; CI testa em matriz Node 22 e 24; `engines >=22.12` (Vitest 5 exige `^22.12 \|\| ^24 \|\| >=26`; máquina local 22.16 funciona). Em 2026-10-31 a página oficial lista as linhas 22, 24 e 26 como LTS; escolhi 24 pelo meio-termo entre maturidade e suporte restante ✅ | 22 / 26 | **Implementada na Entrega 1, aguardando aprovação formal.** Revisar a linha de suporte antes de produção |
| P-03 | ~~Gerenciador de pacotes~~ → **aprovada como A-16 (npm workspaces)** | — | — |
| P-04 | Fila de jobs em tabela Postgres própria com `SKIP LOCKED`, idempotência e supersessão | pgmq/Supabase Queues; pg-boss; pg_cron | Tabela própria (ver ARCHITECTURE §4) |
| P-05 | **[SUPERADA por A-24]** Rota de instalação do Supabase: serviço compose com stack oficial atual (R1) × template EasyPanel (R2) | — | Spike na Entrega 1 para escolher; template tem última atualização 2024-07-26 ✅ |
| P-06 | Auth: cadastro público desativado; conta única criada administrativamente; MFA se disponível | Convite por e-mail | Depende de SMTP (pendência Q-05) |
| P-07 | Ferramenta de migrações: SQL versionado em `supabase/migrations` aplicado por passo explícito (Supabase CLI `db push` ❓ ou runner simples); nunca no boot do app | — | Decidir na Entrega 1/2 |
| P-08 | Acesso do worker ao banco: conexão Postgres direta interna com papel de privilégio mínimo | API com chave secreta do Supabase | Preferir papel dedicado; chave secreta nunca no `web` |
| P-09 | Motor nasce em modo observação/proposta; ações automáticas e progressões por *feature flag* **desligada** até aprovação dos limites | — | Coerente com A-12 |
| P-10 | Backup: dump diário + backup do volume de Storage para destino fora do servidor; RPO ≤ 24 h, RTO ≤ 1 dia; restauração testada trimestralmente | WAL/PITR | Valores sugeridos, não aprovados |
| P-11 | ~~Docker local~~ → **resolvida por A-17** (CI faz build Docker e testes de integração). Consequência: os Dockerfiles **nunca foram executados localmente**; a primeira validação real será o job `docker` do CI | — | — |
| P-12 | Sem ambiente de staging inicialmente; migrações testadas em Postgres descartável no CI | Staging dedicado | Custo de recursos do servidor |
| P-13 | ~~Idioma~~ → **aprovada como A-18**. Documentação: pt-BR (mantido) | — | — |
| P-14 | Service Worker artesanal mínimo (push + clique), sem cache offline avançado | Serwist | **Implementado** (`apps/web/public/sw.js`), sem handler `fetch`. Menos dependências |
| P-15 | CI no GitHub Actions: lint, tipos, testes, build, varredura de segredos, build e smoke test das imagens Docker | — | **Implementado** em `.github/workflows/ci.yml` (nunca executado: não há remoto). Se o build no EasyPanel consumir muita memória, construir a imagem no CI e implantar por imagem |
| P-16 | `/api/health` no web e `/healthz` no worker como observabilidade mínima | Ferramenta externa | **Implementado**, sem serviços pagos |
| P-17 | TypeScript **5.9.3** e ESLint **9.39.5**. TypeScript 7.0.2 existe, mas `typescript-eslint` 8.72 declara `typescript <6.1`; ESLint 10.14 existe, mas `eslint-plugin-react`/`jsx-a11y`/`import` (usados por `eslint-config-next` 16.4.3) não declaram suporte a ESLint 10 ✅ | TS 7 / ESLint 10 | **Implementada.** Atenção: o npm já marca ESLint 9.39.5 como "no longer supported" → rever quando `eslint-config-next` suportar ESLint 10 |
| P-18 | Rotas técnicas em inglês (`/workouts`, `/nutrition`, `/progress`, `/assistant`, `/settings`), rótulos em pt-BR | Rotas em pt-BR | Consequência de A-18 |
| P-19 | Pacotes internos (`shared`, `domain`) exportam **fontes TypeScript** (sem etapa de build); `web` usa `transpilePackages`; o worker é empacotado com esbuild em um único `main.mjs` | Build com `tsc` por pacote | Simplicidade; imagem do worker contém só um arquivo |
| P-20 | Governança do motor no código (`packages/domain`): padrão seguro `autoApplyEnabled=false` e `approvedLimitsVersion=null`; aumentos/estruturais **sempre** aguardam o usuário; aplicação automática exige flag + limites aprovados + veredito de guardrail; nenhum número esportivo no código | — | **Implementada** como contrato e testes; não contém lógica clínica/fisiológica |
| P-21 | Web Push na Entrega 1: arquitetura e UI prontas, **inativas** (`NEXT_PUBLIC_PUSH_ENABLED=false` por padrão; `/api/push/subscribe` responde 501) | Ativar já | Coerente com "não ativar notificações reais sem backend" |
| P-22 | GitHub Actions fixadas por SHA de commit (tag no comentário) | Tags de versão | Mitiga comprometimento de actions de terceiros. SHAs resolvidos pela API do GitHub em 2026-10-31 |
| P-23 | **Worker → banco pela API HTTPS do Supabase com `SUPABASE_SECRET_KEY`** (funções SQL restritas a `service_role`), sem publicar PostgreSQL. **Revisa P-08** (conexão Postgres direta) porque o worker é outro serviço do EasyPanel e a porta do banco não é publicada | Conexão direta `db:5432` se o EasyPanel permitir DNS entre serviços (⚠️ não verificado) | Decidir na Etapa 3 após testar a rede |
| P-24 | **[SUPERADA por A-24 — referência]** Exposição pública do Supabase **somente** por três prefixos no mesmo host gerado: `/auth/v1`, `/rest/v1`, `/storage/v1` (domínios do EasyPanel com caminho). Studio, postgres-meta, Realtime, Functions, pooler e PostgreSQL sem rota pública | Domínio único `/` (Studio atrás do Basic Auth do gateway) | ⚠️ semântica de caminho do EasyPanel a confirmar; `smoke-test.sh` valida |
| P-25 | Segredos do Supabase gerados localmente pelos scripts oficiais e mantidos **fora do repositório** (`~/.triatlo-secrets/supabase.env`, modo 600); colados no `.env` do serviço no EasyPanel; valores nunca impressos | Gerar no servidor | Cópia única: guardar em cofre de senhas |
| P-26 | Auth de uso pessoal: `DISABLE_SIGNUP=true` **desde o primeiro boot**; conta única criada pela API administrativa (`create-admin-user.sh`); telefone, anônimos e provedores sociais desligados; sem SMTP até Q-05 | Habilitar cadastro e desligar depois | Evita janela com cadastro aberto |
| P-27 | **[SUPERADA por A-24 — `infra/supabase` fica só como referência, não implantada]** Stack Supabase adaptada mantida no repositório (`infra/supabase`), com cópia intocada do upstream, `CHANGES-vs-upstream.diff` e `npm run supabase:check` no CI; atualizações só manuais e com backup restaurável | Compose inline no EasyPanel | EasyPanel precisa dos arquivos de `volumes/` no checkout Git |
| P-29 | Escala dos escores de check-in (sono, fadiga, disposição, humor, recuperação): inteiro **1–5**, sem interpretação clínica; qualidade do check-in derivada (coluna gerada) | Escala 0–10, 1–7 | Escolha de produto **não aprovada**; implementada para destravar o MVP e fácil de mudar por nova migration |
| P-30 | Configuração pública (Supabase, push) lida **em runtime** no servidor e passada por props aos clientes, aceitando `NEXT_PUBLIC_*` e nomes simples; `/api/health` com booleanos e `/api/health/supabase` para diagnóstico; recusa de chave privilegiada em variável pública | Depender de build args do EasyPanel | Motivo: o build de produção saiu sem a configuração (ver PRODUCTION_VALIDATION.md) |
| P-31 | Runner de migrations próprio (`supabase/migrate.sh`: transação por arquivo, checksum, recusa de statements destrutivos sem `-- allow-destructive`), aplicável por `--container` no servidor. **Resolve P-07** | Supabase CLI | Sem dependência nova; testado em Postgres descartável e no CI |
| P-32 | **[SUPERADA por A-24 para a instalação atual; vale só para a stack de referência]** Operações no banco real feitas **de dentro do container `backup` do próprio Compose** (já autenticado por `PG*`, com `supabase/` montado somente-leitura em `/supabase`): `migrate.sh`, `migrate.sh --status`, `tests/run.sh --production`, `backup.sh --once`. Nenhuma porta do banco é publicada; nenhum comando depende de adivinhar nomes de container. Plano B: `migrate.sh --container <db>` num clone no host | Publicar a porta do banco; SSH com túnel | ⚠️ depende do checkout do EasyPanel conter o repositório inteiro (`ls /supabase/migrations`) |
| P-33 | **Adaptação à instalação Kong:** chave pública do app = **anon JWT legado** (a stack Kong não aceita chaves opacas `sb_publishable_`); o app aceita `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_ANON_KEY` além dos nomes `PUBLISHABLE`; **recusa** a chave de demonstração pública (por hash SHA-256) e chaves privilegiadas; credenciais privilegiadas só no backend | Migrar para chaves opacas (exige Envoy ou Kong com tradução) | Implementado e testado (`apps/web/src/lib/supabase/env.ts`) |
| P-34 | **Correção mínima de credenciais em fases** (ver `docs/SUPABASE_EASYPANEL.md` → `SUPABASE_EXISTING.md` §3): fase 1 = trio legado `JWT_SECRET`/`ANON_KEY`/`SERVICE_ROLE_KEY` (+ `DASHBOARD_PASSWORD` se padrão) só por variáveis de ambiente + recriação; fase 2 = `POSTGRES_PASSWORD` pelo procedimento oficial **só se padrão e com autorização separada** (inclui `DROP SCHEMA _supavisor`); fase 3 = chaves de criptografia (rotação não documentada pelo upstream) caso a caso | Rotacionar tudo de uma vez | Fase 1 aguarda autorização e ação no EasyPanel |
| P-35 | Operação da instalação existente a partir do **host do servidor** (SSH) com um clone público em `~/triatlo-ops`: inspeção somente leitura, backup (`pg_dump` + roles + Storage) com ensaio de restauração em banco descartável, `migrate.sh --container <db>` e `tests/run.sh --production --container <db>`; `--status`/`--dry-run` estritamente somente leitura | Publicar a porta do banco | Nomes de container vêm da inspeção, nunca adivinhados |
| P-36 | **Identificação do banco por serviço Compose `db` + imagem `supabase/postgres:<tag>` + prova por SQL** (biblioteca `supabase/lib/db-guard.sh`), usada por inspeção, backup, ensaio de restauração, migrations e testes **antes de qualquer escrita**; nunca por substring do nome da imagem (`supabase/postgres-meta` contém `supabase/postgres`: incidente de 2026-10-31). Recusa ambiguidade. Testada com Docker simulado (`npm run ops:test`, também no CI) | Confiar no nome informado | Incidente corrigido; mutação confirma que o teste o detecta |
| P-37 | **Risco de persistência dos volumes dentro do diretório de código do EasyPanel** tratado em 3 passos: backup externo → teste empírico com marcador (`persistence-marker.sh`, portão G1) → opcionalmente mover os dados para fora do diretório (janela autorizada) | Presumir que o redeploy preserva | R1 (destruir serviço apaga arquivos) documentado; R2 (redeploy re-renderiza) incerto até o teste |
| P-38 | **Portões de autorização G1/G2/G3** (marcador+redeploy; correção coordenada de credenciais; migrations), cada um exigindo "sim" explícito e o verde do anterior; plano em `docs/CREDENTIAL_CORRECTION_PLAN.md`. **Refina P-34**: como a inspeção confirmou demo também em PostgreSQL, fases 1 e 2 viram uma única janela coordenada | Correção em fases separadas | Nada executado |
| P-39 | **Motor de adaptação v0 determinístico, só reduções**: gatilhos sempre relativos à mediana *própria* da pessoa (14 dias), dado desconhecido não dispara nada e interrompe a sequência, relato subjetivo nunca é descartado (conflito marca `quality = conflicting`), uma proposta combinada por execução. Nunca produz aumento/progressão de carga. Detalhes em `docs/BUSINESS_RULES.md` | Conferir os números em Configurações antes de aprovar |
| P-40 | **Parâmetros do motor são dado, não código**: `training_rule_sets` versionado e imutável; o rascunho v1 nasce inativo (lookback 14 d, mín. 5 dias com dado, piora de 1 ponto por 2 dias seguidos, sono 20% abaixo do normal, redução de 20%, máx. 3 propostas/semana, 24 h entre mudanças na mesma sessão, horizonte 48 h). **Só o usuário ativa** (botão em Configurações) e só ele liga a aplicação automática (até 20%, reversível) | Aprovar/ajustar os números |
| P-41 | **Camada de dados compartilhada** (`packages/data`): todo módulo (Hoje, Treinos, Alimentação, Evolução, Assistente, worker) lê/escreve pelas mesmas funções e pela view `v_daily_context` (uma linha por dia local; sono: conector > arquivo > manual). Toda consulta filtra `user_id`; o RLS continua sendo a barreira real. O worker usa a chave de serviço **só** no backend (P-23) | — |
| P-42 | **Mudanças de plano atômicas**: RPC `commit_plan_version` (versão + proposta aplicada + auditoria numa transação; 40001 = plano mudou, P0002/P0001 = não encontrada/não aberta). Desfazer = nova versão (nunca apaga) | — |
| P-43 | **Amazfit Active 2 — caminho real**: sem API pública. Importação de arquivos reais: **GPX/TCX** de treinos e **export.xml do Apple Health** (inventário por origem para o usuário escolher o app do relógio; sono, FC de repouso, HRV e treinos). Tipo de atividade desconhecido exige a modalidade escolhida pelo usuário (nunca adivinhada); reimportar é idempotente (`external_id` + hash do arquivo). FIT não implementado | Arquivo real do usuário para validar com dados reais |
| P-44 | **Análise de foto de refeição por IA**: Chat Completions compatível com a OpenAI + Structured Outputs; **sem modelo padrão** (`AI_MODEL` obrigatório), chave só no servidor, consentimento explícito, limite diário (padrão 30), cada chamada registrada só com categorias de dados. Resposta tratada como não confiável (zod); resultado é estimativa, revisada pelo usuário; total de refeição só soma um nutriente quando todos os itens o têm | Custo e escolha do modelo (Q-25) |
| P-45 | **Notificações**: máx. 4/dia, lembrete de treino 60 min antes, check-in sugerido entre 9–12 h locais se ainda não feito, adaptação diária a partir das 6 h locais, horário silencioso, payload sem dado de saúde, 3 tentativas, 404/410 desativa a inscrição | Ajustar os valores |
| P-46 | **Sessão web**: `src/proxy.ts` renova a sessão do Supabase e leva visitante sem sessão para `/login`; API responde 401; **não há rota de cadastro** (conta única criada pelo administrador); a identidade é verificada com `auth.getUser()` (não só com o cookie) | — |
| P-47 | **Planejamento da semana** (`planWeek`): o usuário informa quantas sessões e quanto tempo; o sistema só escolhe *onde/quando* dentro das janelas de treino dele (1 sessão por dia por padrão). O que não couber é informado, não forçado. Não cria carga | — |
| P-48 | **`auth.uid()` precisa funcionar só com `request.jwt.claims`** (único GUC que o PostgREST ≥ 10 define). Achado no CI: a imagem `supabase/postgres` sem GoTrue traz um `auth.uid()` legado que lê só `request.jwt.claim.sub` ⇒ NULL ⇒ todo RLS falha. Em produção o GoTrue já migrou a função, mas agora isso é **provado**: `36_auth_uid_contract.sql` roda também em `--production` (G3) e os helpers de teste deixaram de definir o GUC legado que mascarava o problema | — |
| P-28 | Backup: serviço `backup` no compose (dump `-Fc`, roles, tar do Storage, sha256, retenção 14 dias, 06:00 UTC); **cópia externa pendente (Q-03)**; restauração a **ensaiar** | Backup de volume do EasyPanel | Não declarar backup externo enquanto Q-03 estiver aberto |

## C. HIPÓTESES a validar

| ID | Hipótese | Como validar |
|---|---|---|
| H-01 | O Zepp grava no Apple Health categorias suficientes (treinos, FC, sono, HRV) para o motor | Spike manual no iPhone (INTEGRATIONS §1.4) |
| H-02 | Atalhos do iOS conseguem enviar amostras do Apple Health ao backend de forma confiável | Spike na Entrega 7 |
| H-03 | O servidor do usuário comporta Supabase + web + worker + builds | Medir (Entrega 1) |
| H-04 | O serviço *compose* do EasyPanel aceita o compose oficial atual do Supabase | Spike na Entrega 1 |
| H-05 | A fila própria em Postgres atende à carga (centenas de jobs/dia) sem complexidade extra | Teste de carga leve na Entrega 4 |
| H-06 | Push no iPhone chega com a PWA instalada, respeitando Foco | Teste em dispositivo real (Entrega 4) |

## D. PENDÊNCIAS (informação ou decisão ausente)

| ID | Pendência | Bloqueia |
|---|---|---|
| Q-01 | Especificação do servidor (RAM/vCPU/disco/SO), versão do EasyPanel, outros serviços no mesmo host | Instalação do Supabase e primeiro deploy (A-20) |
| Q-02 | Domínio e DNS (subdomínios `app`, `api`, studio) | Primeiro deploy / HTTPS / teste de push no iPhone |
| Q-03 | Destino off-server de backup e orçamento | Entrega 2 |
| Q-04 | Forma de acesso do EasyPanel ao repositório privado (token do servidor × deploy key) | Primeiro deploy |
| Q-05 | SMTP para e-mails do Auth (ou dispensa) | Entrega 2 |
| Q-06 | **Limites quantitativos de progressão, redução e intensidade** (aprovados por quem?) e janelas/horários do motor (diário, coalescência, histerese) | Entrega 6 — **não inventar** |
| Q-07 | Fuso horário padrão do usuário e horários de sono/trabalho para silêncio de notificações | Entrega 3/4 |
| Q-08 | Caminho de integração Amazfit (I-1…I-6) | Entrega 7 |
| Q-09 | Necessidade/aceitação de app nativo iOS e custo da conta Apple Developer | Entrega 7 |
| Q-10 | Quais dados poderão ser enviados à IA (fotos, texto, histórico) e orçamento mensal | Entrega 5 |
| Q-11 | Limites de frequência de notificações (máx/dia, horários de silêncio) | Entrega 4 |
| Q-12 | Política de retenção de dados e backups após exclusão | Entrega 2 |
| Q-13 | Existe acompanhamento profissional (médico/nutricionista/treinador) cujas orientações devam entrar como restrições? | Entrega 6 |
| ~~Q-14~~ | ~~Autorização para repositório remoto e primeiro push~~ — **resolvida** em 2026-10-31 (push de `main` autorizado; commits `32bc23b`, `fb047be`, `87c2a11`, `d00e8fc`) | — |
| ~~Q-15~~ | ~~Conta pessoal ou organização~~ — **resolvida**: conta pessoal `jhanryw`. O CI passou a usar a imagem oficial do gitleaks (não exige licença) | — |
| Q-16 | Aprovação formal de P-02 (Node 24), P-17, P-19…P-28 | Entrega 2 |
| ~~Q-17~~ | ~~Repositório público vs. privado~~ — **resolvida por A-23**: permanece público por decisão do proprietário | — |
| Q-19 | 🔴 **(atualizada por A-24: mantemos a instalação; a correção é a fase 1 de P-34)** **Supabase em produção usa o `JWT_SECRET` padrão público e não é a stack do repositório** (Kong; aceita a chave anon de demonstração). Parar o serviço e substituí-lo (ver `docs/PRODUCTION_VALIDATION.md`) | Qualquer uso de dados reais |
| Q-20 | Confirmar a aprovação da escala 1–5 (P-29) e do restante P-30/P-31 | Etapa 4 (UI persistente) |
| Q-21 | **Autorização para corrigir as credenciais** (fase 1 de P-34) e ação no EasyPanel | Qualquer migration/dado real |
| Q-25 | **Custo e escolha do modelo de IA** (`OPENAI_API_KEY` + `AI_MODEL`) para a análise de fotos; sem isso a tela de refeição funciona só manualmente | Fotos por IA |
| Q-22 | **Autorização para aplicar as 9 migrations** ao PostgreSQL existente (depois de backup, `--status` e `--dry-run`) | Persistência real |
| Q-24 | Saída da inspeção corrigida (seções 1, 3, 4, 5, 5b, 7, 8) para fechar o plano de credenciais e a decisão sobre mover os volumes | Portão G2 |
| Q-23 | Confirmar a versão real do PostgreSQL (inferida 15.8.1.085) e os nomes de variáveis/containers (rodar a inspeção) | `migrate.sh` |
| Q-18 | Confirmações na tela do EasyPanel (⚠️ em `docs/SUPABASE_EASYPANEL.md`): Compose via Git com `./volumes`, domínio gerado para Compose, domínios com caminho, versão do Docker Compose | Deploy do Supabase |

## F. Registro do primeiro CI (2026-10-31)

| Run | Commit | Resultado | Observação |
|---|---|---|---|
| #1 | `fb047be` | falhou | `quality` (Node 22 e 24) e `docker` verdes; `gitleaks-action` retornou exit 1 e o log exige login |
| #2 | `87c2a11` | falhou | gitleaks passou a rodar pela imagem oficial `zricethezav/gitleaks:v8.30.1` com achados redigidos como anotações: **1 achado** (`generic-api-key`, `docs/DECISIONS.md:61`) |
| #3 | `d00e8fc` | **sucesso** | achado = falso positivo (texto com o nome de `create-admin-user.sh`); exceção restrita a um arquivo e uma regra em `.gitleaks.toml`. Jobs: `quality` (Node 22, 24), `security` (npm audit + gitleaks), `docker` (build + smoke test web/worker) |

Nota: tentei executar o binário do gitleaks localmente para diagnosticar; o ambiente bloqueou a execução de código baixado e não contornei — o diagnóstico foi feito pelo próprio CI.

## E. Registro de bloqueios técnicos conhecidos

- Sem API pública do Amazfit comprovada (INTEGRATIONS §1.2).
- PWA sem acesso a HealthKit (INTEGRATIONS §2).
- Docker ausente na máquina de desenvolvimento (A-17). **Atualização 2026-10-31:** o CI (GitHub Actions) executou com sucesso o build das imagens web/worker e os smoke tests (run #3, commit `d00e8fc`); o compose do Supabase continua **nunca executado**.
- O navegador embutido do app de desenvolvimento bloqueia service workers (mesmo erro ao registrar uma URL que não é script) — o registro real do `sw.js` precisa ser conferido no Safari/Chrome; a lógica do worker está coberta por teste unitário.
- Porta 3000 local ocupada por outro processo do usuário (pid 14448, não tocado); o preview usou 3100.
- Template Supabase do EasyPanel possivelmente defasado (P-05).
- Procedimento de backup do Supabase self-hosted não fornecido pela documentação oficial consultada — será escrito e testado por nós.

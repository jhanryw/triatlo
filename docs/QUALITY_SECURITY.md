# QUALITY_SECURITY — Testes, autenticação, RLS e backup

> Estado: Entrega 0, **[PROPOSTA]** (nada implementado). Os testes aqui descritos são critérios de aceitação das Entregas 1–8.

## 1. Pirâmide de testes

| Nível | Alvo | Ferramenta candidata ❓ | Quando roda |
|---|---|---|---|
| Unitário | `packages/domain` (regras puras), `packages/shared` (schemas), utilitários de fuso/horário | Vitest | Cada commit/PR |
| Integração | Worker + Postgres real: fila, idempotência, supersessão, retentativas, lease expirada | Vitest + Postgres efêmero (container) | PR e `main` |
| Banco / RLS | Políticas, permissões de papéis, Storage | SQL de teste (pgTAP) via CLI do Supabase ❓ ou testes SQL próprios | PR que toque `supabase/` |
| Contrato | Payloads de job e DTOs entre web ↔ worker | Schemas em `packages/shared` | Cada commit |
| E2E | Login, instalação PWA (manifest), check-in, fluxo de aprovação | Playwright | `main` e pré-release |
| Manual em dispositivo | Push no iPhone real, instalação na Tela de Início, câmera/foto | Checklist | Entregas 4 e 5 |
| Segurança | Varredura de segredos, dependências vulneráveis, headers | gitleaks/trufflehog ❓, `npm audit` | CI |

Observação: **Docker não existe na máquina local atual**; testes de banco/RLS locais precisam dele (ou rodar só no CI). Decisão P-11.

Regras gerais: nenhum teste usa dados reais de saúde; relógio/tempo sempre injetável (sem `Date.now()` solto no domínio); testes de fuso incluem horário de verão e viagem.

## 2. Autenticação **[PROPOSTA]**

- Supabase Auth, e-mail + senha forte; **cadastro público desativado**; usuário único criado administrativamente.
- Sessão por cookies httpOnly/secure/sameSite via `@supabase/ssr` ❓. Verificação de usuário no servidor em toda ação (validar JWT/`getUser` conforme recomendação atual da biblioteca ❓ — conferir na Entrega 2; não confiar apenas em dados de sessão lidos do cookie sem verificação).
- MFA/TOTP desejável ❓ (conferir suporte na versão self-hosted instalada).
- Rate limiting de login/recuperação (Auth + proxy). Recuperação de senha depende de SMTP (P-06/pendência).
- Logout e revogação de sessões nas Configurações.
- Testes: rota protegida redireciona; Server Action sem sessão falha; token expirado/forjado falha; cadastro público bloqueado.

## 3. RLS e autorização **[PROPOSTA]**

Convenções:
1. Toda tabela em `public` com dados do usuário: `user_id uuid not null default auth.uid()`, **RLS habilitada**, políticas separadas por operação (`select/insert/update/delete`) com `to authenticated` e `using/with check (user_id = (select auth.uid()))` (forma com `select` para cache do planner ❓ conferir recomendação atual).
2. Nenhuma política para `anon` em dados de saúde. Tabelas de configuração global (se houver) somente leitura.
3. Funções `security definer` só quando indispensáveis, com `search_path` fixo, em schema não exposto.
4. Tabelas operacionais (jobs, auditoria): acesso do app via papel restrito; usuário final lê apenas o que for seu e nunca altera `audit_log`.
5. Papel do worker: privilégios mínimos e explícitos (não superusuário); chave secreta do Supabase restrita ao worker, jamais ao `web`/navegador.
6. Storage: bucket `meal-photos` **privado**; políticas por prefixo `auth.uid()::text = (storage.foldername(name))[1]`; tamanho/MIME limitados; URLs assinadas curtas; sem listagem pública.

Testes obrigatórios (Entrega 2, executados no CI):
- `anon` não lê nem escreve em nenhuma tabela de usuário.
- Usuário A (fixture) não lê, altera nem apaga dados do usuário B — mesmo sendo uso individual, valida o isolamento.
- `insert` com `user_id` de outro usuário é rejeitado (`with check`).
- Toda tabela nova **sem RLS falha o CI** (teste que consulta `pg_tables.rowsecurity`).
- Storage: A não obtém objeto de B; anônimo não obtém nenhum; upload fora do prefixo é recusado.
- Bundle do frontend não contém a chave secreta/`service_role` (teste de varredura do build).

## 4. Segurança de aplicação

- HTTPS only; HSTS; cabeçalhos (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/CSP `frame-ancestors`, CSP restritiva) ✅ a doc do Next.js mostra o padrão de cabeçalhos; `sw.js` servido sem cache.
- Validação de entrada com schema em toda fronteira (Server Action, Route Handler, job payload, saída de IA).
- Auditoria das alterações automáticas (quem/qual regra/dados/versão antes→depois), imutável.
- Logs sem dados de saúde identificáveis; sem segredos em logs/erros.
- Dependências: lockfile, versões fixadas, revisão de novas dependências, `npm audit` no CI.
- IA: lista visível do que é enviado; minimização; chamadas registradas; limites de custo; saída tratada como não confiável (validação de schema, sem execução de instruções vindas de conteúdo de fotos/texto).
- Exportação completa e exclusão (por item e total) com confirmação; exclusão remove também objetos de Storage e agenda expurgo de backups conforme retenção documentada.

## 5. Backup e recuperação **[PROPOSTA]**

Escopo do que precisa ser salvo:
| Dado | Local (self-hosted) ✅ | Método |
|---|---|---|
| PostgreSQL (inclui Auth e schema `public`) | `volumes/db/data` | `pg_dump` completo diário (inclui schemas `auth`, `storage`, `public`) + retenção 7 diários/4 semanais/3 mensais (**[PENDENTE]**) |
| Fotos | `volumes/storage` ou bucket S3 | Backup de volume agendado (EasyPanel ✅) ou sincronização do bucket |
| Configuração/segredos | `.env` do Supabase e do app | Cofre fora do servidor; nunca no Git |
| Migrações/código | GitHub | Repositório privado |

Requisitos:
1. Destino **fora do servidor**, criptografado em repouso (criptografia client-side do dump ❓).
2. Script em `infra/backup/` + job agendado (cron do host/serviço do EasyPanel ou job do worker) com verificação de tamanho/hash e alerta de falha.
3. **Backup obrigatório antes de qualquer migração e de atualização do Supabase.**
4. **Runbook de restauração** (`infra/backup/RESTORE.md`) testado: restaurar num Postgres/stack descartável, subir app apontando para ele, validar login, leitura de dados e acesso a uma foto.
5. Teste de restauração agendado (trimestral) e registrado em DECISIONS/ROADMAP.
6. RPO/RTO: P-10 **[PENDENTE]**.

## 6. Critérios de aceitação transversais (valem para todas as entregas)

- Lint, checagem de tipos, testes e build passam no CI.
- Nenhum segredo no repositório (varredura limpa).
- Migração nova inclui RLS + teste.
- Documentação e DECISIONS atualizados na mesma entrega.
- Relatório de entrega com os 7 itens exigidos (implementado, arquivos, testes, o que não funciona, decisões pendentes, como executar, ações manuais).

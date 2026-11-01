# DATABASE_SCHEMA — esquema inicial (migrations `20261101120000`…`20261101120600`)

> Estado: **implementado e testado em um PostgreSQL descartável** (8 arquivos de teste SQL passam localmente; o CI roda os mesmos testes na imagem real `supabase/postgres:17.6.1.136`). **Ainda não aplicado ao Supabase de produção** — ele precisa ser substituído antes (ver [PRODUCTION_VALIDATION.md](PRODUCTION_VALIDATION.md)).
> Nada aqui contém fórmula, limite ou critério clínico/esportivo (Q-06). A escala 1–5 dos check-ins é a **proposta P-29**.

## Convenções
- Toda tabela pessoal: `user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users ON DELETE CASCADE` (apagar a conta apaga tudo — direito de exclusão, testado).
- **FK composta** `(filho_id, user_id) → (pai_id, user_id)`: uma linha nunca pode apontar para dado de outro usuário (a RLS não é consultada em checagens de FK).
- RLS ligada em **todas** as tabelas; o Supabase concede `ALL` a `anon`/`authenticated` por padrão, então cada migration faz `REVOKE` e `GRANT` explícitos. Uma política por operação (`select`/`insert`/`update`/`delete`) usando `(select auth.uid())`.
- **Ausente × parcial × zero:** ausência de registro = **não existe linha**; registro parcial = colunas `NULL` (+ `quality`); zero = o valor `0` gravado. `quality` de linha ∈ {`complete`,`partial`,`conflicting`} (`missing` não é estado de linha). Em `daily_checkins` a qualidade é **coluna gerada**.
- **Proveniência:** `source` ∈ {`manual`,`file_import`,`external_connector`}, `external_id` (obrigatório se não for manual; índice único ⇒ importação idempotente), `recorded_at`/horário do evento, `received_at`, `quality`, `import_id` → `data_import_provenance`.

## Tabelas
| Módulo | Tabela | Pontos de segurança/integridade |
|---|---|---|
| Perfil | `profiles` | fuso IANA `NULL` até o usuário definir (Q-07) |
| Preferências | `user_preferences` | `auto_apply_enabled` exige `approved_limits_version` (espelha `packages/domain`); consentimento de IA `NULL` = sem consentimento |
| Planos | `training_plans`, `training_plan_versions` | versões **imutáveis** (sem UPDATE/DELETE); cadeia sem buracos (FK `(plan_id, parent_version)`) |
| Treino planejado | `planned_workouts` | snapshot por versão; intensidade opaca `{scale,value}`; sem defaults esportivos |
| Treino realizado | `completed_workouts` | duração `0` rejeitada (use `NULL`); exertion exige escala+valor; importação idempotente |
| Propostas | `workout_change_proposals` | conteúdo congelado (UPDATE só de `status`, `decided_at`, `applied_version`); `applied_version` ⇔ status `applied`/`reverted` |
| Aprovações | `user_approvals` | uma decisão por proposta; imutável |
| Auditoria | `adaptation_audit` | append-only (INSERT/SELECT) |
| Check-in | `daily_checkins` | 1 por dia; escores 1–5 (P-29); vazio é inválido |
| Sono | `sleep_observations` | `NULL` (desconhecido) ≠ `0` (zero registrado); período coerente |
| Fisiologia | `physiological_observations` | `available` exige valor+unidade; `not_measured` é explícito e não carrega valor; métrica e método da fonte |
| Alimentação | `meals`, `meal_items`, `nutrition_estimates` | foto só na própria pasta; quantidade `NULL`≠`0`; estimativa exige ≥1 valor e é sempre rotulada (`method`, `confidence`) |
| Notificações | `push_subscriptions` | **chaves `p256dh`/`auth` ilegíveis ao cliente** (privilégio por coluna); só `service_role` as lê; inserir para outro usuário é negado |
| | `scheduled_notifications` | o usuário só agenda para si (`pending`) e cancela; **não** marca `sent` nem edita payload |
| Fila | `background_jobs` + funções `enqueue/claim/complete/fail/supersede_background_jobs` | sem acesso para `anon`/`authenticated`; funções só `service_role`; `SKIP LOCKED`, lease, tentativas, `dead` |
| Importação | `data_import_provenance` | origem, arquivo, hash, contagens |
| Storage | bucket `meal-photos` (privado) + políticas em `storage.objects` | caminho `"<user id>/…"`; condicional à existência do Storage |

## Migrations 8–9 (motor e planejamento)
| Objeto | Regras |
|---|---|
| `availability_windows` | janelas de treino/trabalho/etc. por dia da semana; fim > início |
| `training_rule_sets` | parâmetros imutáveis e versionados; só `status`/`approved_at`/`notes` mudam; nasce `draft` |
| `ai_calls` | só insert/select (registro sem conteúdo: finalidade, provedor, modelo, categorias, tokens, status) |
| `meal_analyses` | resultado bruto da IA (validado) + confiança + status; permanece estimativa até a revisão |
| `v_current_planned_workouts`, `v_daily_context` | `security_invoker`; uma linha por dia local, nulos = desconhecido, `timezone_assumed` quando o perfil não tem fuso |
| `commit_plan_version(...)` | RPC `security invoker`: nova versão + proposta aplicada + auditoria atômicas |

## Contratos TypeScript
`packages/shared/src/records.ts` (entradas validadas com zod) e `packages/domain/src/availability.ts` (`dayStatuses`, `measureState`, `averageOfKnown`: dado ausente nunca vira zero). `packages/shared/src/db-contract.test.ts` falha se um vocabulário `CHECK … IN (…)` do SQL divergir das constantes do TypeScript ou se um campo de schema não for coluna real.

## Limites conhecidos
- Quem escreve `adaptation_audit` é a sessão do usuário (servidor Next.js). Resistência a adulteração por parte do próprio usuário exigiria funções `SECURITY DEFINER`: aceito no uso individual; revisitar se houver outro cenário.
- `scheduled_notifications.payload` é validado pelo worker (`PushPayloadSchema`) antes de enviar; o banco só garante que é objeto JSON.
- Sem triggers que criem perfil automaticamente; o app cria o perfil no primeiro acesso (Etapa 4).

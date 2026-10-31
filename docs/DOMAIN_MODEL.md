# DOMAIN_MODEL — Modelo conceitual de planos, propostas, aprovações e auditoria

> Estado: **[PROPOSTA]** conceitual, implementada como contratos (`packages/shared`) e funções puras (`packages/domain`) na Entrega 1. **Não há tabelas ainda** (Entrega 2) e **nenhum critério quantitativo esportivo** (limites de progressão/redução/intensidade são a pendência Q-06 e **não foram inventados**).

## 1. Ideia central

O plano de treino nunca é editado: cada mudança aceita gera uma **nova versão imutável**. Mudanças nascem como **propostas** com justificativa; passam por decisão (automática somente sob política aprovada, ou do usuário); tudo vira **auditoria** append-only; **desfazer** cria outra versão que restaura o conteúdo anterior.

```
PlanVersion v1 ──proposta──▶ (aprovação | política automática) ──▶ PlanVersion v2 ──desfazer──▶ PlanVersion v3 (revertOf=1)
                     │                                                    │                          │
                     └───────────────────────── AuditEntry ◀──────────────┴──────────────────────────┘
```

## 2. Entidades e onde vivem no código

| Entidade | Papel | Contrato (`packages/shared`) | Regras (`packages/domain`) |
|---|---|---|---|
| **PlannedSession** | Sessão: modalidade, objetivo, início (UTC), duração, intensidade *opaca*, metas livres, instruções, estado (planejado/realizado/parcial/substituído/reagendado/cancelado) | `PlannedSessionSchema` (`plan.ts`) | — |
| **PlanVersion** | Foto imutável do plano; `version` monotônico, `parentVersion`, `createdBy`, `reason`, `proposalId`, `revertOf` | `PlanVersionSchema` | `applyProposal`, `revertToVersion` (`plan-versioning.ts`) |
| **ChangeProposal** | Mudança proposta: `baseVersion`, `changeClass` (`auto_safe` / `needs_approval` / `structural`), `trigger` (diário/evento/manual), `changes[]`, `rationale`, `status`, validade | `ChangeProposalSchema` (`adaptation.ts`) | `decideApplication` (`autonomy.ts`) |
| **PlanChange** | Edições estruturais sem sentido clínico: reagendar, atualizar campos, cancelar, adicionar sessão | `PlanChangeSchema` | aplicadas por `applyProposal` |
| **Rationale** | Justificativa: resumo, regras aplicadas (`ruleIds`), dados usados (`dataRefs`), **qualidade dos dados** (completo/parcial/ausente/conflitante), ressalvas | `RationaleSchema` | — |
| **ApprovalDecision** | Decisão do usuário (aprovou/recusou) — o schema **rejeita** decisor que não seja o usuário | `ApprovalDecisionSchema` | exigida por `applyProposal` |
| **AuditEntry** | Registro append-only: quem, qual ação, versões de→para, regras, resumo, detalhes estruturados | `AuditEntrySchema` | gerada por `applyProposal`/`revertToVersion` |
| **Job** | Tarefa assíncrona idempotente (`idempotencyKey`, `sourceRef` para supersessão) | `JobEnvelopeSchema`, `buildIdempotencyKey` (`jobs.ts`) | — (executor: Entrega 4) |
| **NormalizedRecord / DataSource** | Registro normalizado de qualquer fonte; ausente fica nulo, nunca zero; origem sempre declarada | `data-source.ts` | — |
| **PushPayload / PushSubscription / Consent** | Contratos de notificação mínima e consentimento | `notifications.ts` | — |
| **AiProvider / AiDisclosure** | Abstração de provedor de IA e declaração de dados enviados | `ai.ts` | — |

## 3. Ciclo de vida de uma proposta

`proposed` → `approved` | `rejected` | `expired` | `superseded`; `approved`/`proposed(auto)` → `applied` → `reverted` (marcada quando uma reversão desfaz a versão que ela produziu — responsabilidade da camada de persistência, que ainda não existe).

Quem decide (função `decideApplication`, padrão seguro):

| Classe | Padrão atual | Aplicação automática possível? |
|---|---|---|
| `needs_approval` (aumento de carga/intensidade) | aguarda o usuário | **Nunca** |
| `structural` (fase, progressão significativa, periodização) | aguarda o usuário | **Nunca** |
| `auto_safe` (reorganização de horário, redução dentro de limites aprovados) | aguarda o usuário (`auto_apply_disabled`) | Somente com **todas** as condições: `autoApplyEnabled=true` **e** `approvedLimitsVersion` definido **e** veredito de guardrail "dentro dos limites aprovados". Hoje o veredito não existe → nada é automático |

## 4. Invariantes (testadas em `packages/domain/src/domain.test.ts`)

1. Versões nunca mudam; aplicar produz `version = anterior + 1`, `parentVersion` = anterior, sem mutar a entrada.
2. Proposta só se aplica se `baseVersion` = versão corrente (concorrência otimista) e o `planId` coincide.
3. Aplicação exige autorização explícita: aprovação do usuário *correspondente à proposta* **ou** decisão automática `apply` de uma proposta `auto_safe`.
4. Mudança em sessão inexistente ou adição de sessão duplicada falha sem efeito parcial.
5. Toda aplicação/reversão gera `AuditEntry` com regras e qualidade dos dados.
6. Reverter para a versão corrente ou inexistente é erro; reverter cria nova versão (`revertOf`), nunca reescreve o histórico.
7. Atualização parcial de sessão não injeta valores padrão sobre os existentes.

## 5. O que este modelo deliberadamente NÃO contém

- Nenhum limite numérico (progressão, redução, intensidade, volume), zona, fórmula de carga ou critério de recuperação. `intensity` é `{scale, value}` opaco; metas são `{metric, unit, value}` livres.
- Nenhuma regra de estabilidade/anti-oscilação numérica (intervalos mínimos, janelas de coalescência): definir em `BUSINESS_RULES.md` e aprovar (Q-06) antes da Entrega 6.
- Nenhuma lógica de conflito subjetivo × relógio (apenas o campo `dataQuality: conflicting`).

## 6. Próximos passos (conceitual → persistência)

Entrega 2 traduz o modelo em tabelas com `user_id`, RLS e testes: `plans`, `plan_versions` (imutável), `change_proposals`, `approval_decisions`, `audit_log` (append-only, sem UPDATE/DELETE para o usuário), `jobs`, `push_subscriptions` + consentimento. O desenho SQL será documentado em `DATABASE_SCHEMA.md`.

# CLAUDE.md — Triatlo Inteligente

Aplicativo pessoal (uso de uma única pessoa) de treino, alimentação e recuperação para retorno ao triatlo olímpico. Antes de qualquer trabalho, leia os documentos relevantes em `docs/`.

## Fonte da verdade
- Visão e princípios: `docs/PROJECT_BRIEF.md`
- Arquitetura e riscos: `docs/ARCHITECTURE.md` · Infra/deploy: `docs/INFRASTRUCTURE.md`
- Testes, Auth, RLS, backup: `docs/QUALITY_SECURITY.md`
- Integrações (Amazfit, IA, push): `docs/INTEGRATIONS.md`
- **Decisões e pendências: `docs/DECISIONS.md`** — consulte sempre; só ID `A-*` é aprovado. `P-*` são propostas, `H-*` hipóteses, `Q-*` pendências.
- Marcos e critérios de aceitação: `docs/ROADMAP.md`
- Modelo conceitual de planos/propostas/auditoria: `docs/DOMAIN_MODEL.md` · Deploy: `docs/DEPLOYMENT.md`.
- Ainda a criar nas entregas indicadas: `PRD.md`, `DATABASE_SCHEMA.md` (E2), `BUSINESS_RULES.md` (antes da E6), `DESIGN_SYSTEM.md`.

## Regras de trabalho
1. **Não altere regras de produto silenciosamente.** Mudou comportamento, limite, texto de política ou escopo? Registre em `docs/DECISIONS.md` como proposta e peça aprovação. Não mova itens para "Aprovadas" por conta própria.
2. **Trabalhe por entregas pequenas e verificáveis**, na ordem do ROADMAP. Não construa várias entregas de uma vez. A Entrega 1 só começa após aprovação explícita do plano.
3. **Execute testes, lint, checagem de tipos e build antes de declarar algo concluído**, e relate o resultado real (incluindo falhas). Não declare "funciona" sem ter executado.
4. **Todo relatório de entrega** traz: o que foi implementado; arquivos modificados; como foi testado; o que ainda não funciona; decisões pendentes; como executar/validar; ações manuais necessárias.
5. **Nada destrutivo sem confirmação**: apagar dados, `reset`, `drop`, `force push`, migração destrutiva, sobrescrever volumes. Backup antes de migrar.
6. **Nenhum serviço pago, conta nova ou dependência relevante sem autorização.** Consulte a documentação oficial e a versão atual antes de escolher/atualizar dependências; fixe versões.

## Segurança e privacidade (não negociável)
- Nunca versionar segredos (chaves, tokens, `.env`, dumps, fotos, dados de saúde). Só `.env.example` com placeholders.
- A chave privilegiada do Supabase (`service_role`/`SUPABASE_SECRET_KEY`) **nunca** vai ao frontend, a `NEXT_PUBLIC_*` ou ao Git. A chave privada VAPID só existe no worker.
- Toda tabela com dado do usuário: `user_id`, **RLS habilitada**, política testada. Migração sem RLS+teste não é aceita.
- Validar permissão e entrada no servidor em toda fronteira. Fotos em bucket privado com URL assinada.
- Não enviar dados pessoais a modelos de IA sem a configuração e o consentimento descritos em `docs/INTEGRATIONS.md §3`. Saída de IA é não confiável: validar contra schema.
- Não usar dados simulados em produção; dados de exemplo só em `supabase/seed`, rotulados.

## Regras de domínio (resumo — detalhes em BUSINESS_RULES.md quando existir)
- **LLM nunca é o único decisor.** Cálculo determinístico → guardrails → tendências → interpretação generativa. Alterações de treino só pelo caminho validado no backend (`packages/domain`), com versionamento, justificativa, auditoria e *undo*.
- **Não inventar** limites quantitativos de progressão/redução/intensidade, fórmulas fisiológicas, APIs ou métricas do Amazfit. Sem limites aprovados (Q-06) → progressões automáticas **desativadas**.
- Dados ausentes ≠ zero; ausência de registro de refeição ≠ ausência de refeição; ingestão e gasto energético são estimativas incertas; correlação ≠ causalidade.
- Sem diagnóstico (inclui REDs), sem dietas clínicas, sem suplementação individualizada, sem substituir avaliação médica/nutricional.
- Sem culpa, sem gamificação punitiva, sem sequências obrigatórias, sem metas de restrição alimentar; treino perdido não é penalizado nem acumulado.
- Aumentos de carga/intensidade e mudanças estruturais exigem aprovação do usuário. Relato subjetivo relevante não é anulado por métrica do relógio.
- Amazfit Active 2 é a única fonte esportiva. Sem scraping, engenharia reversa ou integrações com Strava/Garmin/Polar/COROS.

## Convenções técnicas (propostas — ver P-* em DECISIONS.md)
- Monorepo: `apps/web`, `apps/worker`, `packages/shared`, `packages/domain`, `supabase/`, `infra/`, `docs/`.
- `packages/domain`: funções puras, sem I/O, tempo injetável, 100% testável.
- Horários em UTC no banco; fuso IANA do usuário no perfil. Jobs idempotentes com chave de idempotência e supersessão ao reagendar.
- Migrações forward-only em `supabase/migrations`, aplicadas por passo explícito (nunca no boot da aplicação).
- Código/identificadores em inglês; interface e documentação em pt-BR (A-18).
- Web Push: permissão apenas após ação explícita do usuário; envio só pelo worker.

## Comandos (raiz do repositório; npm workspaces)
- `npm ci` — instala exatamente o lockfile. `npm run dev` — app em modo desenvolvimento. `npm run dev:worker` — worker.
- `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run security:check` (depois do build) · `npm run check` (todos).
- Docker não existe na máquina local: build/smoke test das imagens acontecem no GitHub Actions (A-17). Não declare imagens "validadas" sem o CI.
- Versões são fixas (`.npmrc` tem `save-exact`): ao adicionar dependência, confira a versão atual com `npm view` e comite o `package-lock.json`.
- Regras de produto/idioma aprovadas: ver `docs/DECISIONS.md` (A-15…A-22). Código em inglês, UI em pt-BR.
- Conteúdo ilustrativo na UI deve usar `DemoCard`/`DemoBadge` (`apps/web/src/components/ui.tsx`); nunca apresentar dado fictício como real.

## Ao terminar uma tarefa
Atualize os documentos afetados na mesma entrega, liste pendências novas em `docs/DECISIONS.md` e apresente o relatório de 7 itens.

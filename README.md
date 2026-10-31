# Triatlo Inteligente

Aplicativo pessoal de treino, alimentação e recuperação para retorno ao triatlo olímpico.

**Estado: Entrega 1 — fundação executável (local).** Há navegação, estados vazios e algumas telas de demonstração
identificadas. Não há autenticação, banco de dados, treinos reais, notificações reais, IA nem integração com o Amazfit.

## Requisitos

- Node.js ≥ 22.12 (recomendado 24, ver `.nvmrc`) e npm ≥ 10.9. Docker **não** é necessário localmente.

## Abrir o app localmente

```bash
npm ci
npm run dev        # http://localhost:3000  (se a porta estiver ocupada, o Next escolhe outra e informa)
```

Sem variáveis de ambiente o app funciona (Supabase e push aparecem como "não configurados"). Para instalar como PWA é
preciso HTTPS (ou `localhost`); notificações só funcionam após a Entrega 4.

## Verificações

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run security:check     # rode depois do build: também varre os bundles do navegador
npm run check              # tudo acima, em sequência
```

Worker (esqueleto, sem banco): `npm run dev:worker` e `curl http://localhost:8081/healthz`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `apps/web` | Next.js 16 (App Router), Tailwind 4, PWA, UI mobile-first |
| `apps/worker` | Worker Node (esqueleto: loop, `/healthz`); jobs e push na Entrega 4 |
| `packages/shared` | Contratos (zod): plano versionado, propostas, aprovações, auditoria, jobs, push |
| `packages/domain` | Regras puras e determinísticas (governança de autonomia, versionamento, desfazer) |
| `supabase/`, `infra/` | Reservados (Entrega 2) |
| `docs/` | Documentação; comece por `docs/PROJECT_BRIEF.md` e `docs/DECISIONS.md` |

Deploy: `docs/DEPLOYMENT.md` · Decisões e pendências: `docs/DECISIONS.md` · Plano: `docs/ROADMAP.md` · Regras para IA: `CLAUDE.md`.

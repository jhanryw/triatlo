# apps/worker

Processo Node dedicado (uma réplica). **Entrega 1: esqueleto** — configuração (`config.ts`), logs JSON, loop sequencial (`loop.ts`) e probe `GET /healthz` (`health.ts`). Não conecta a banco, não envia notificações e não executa lógica do motor.

- `npm run dev -w @triatlo/worker` (tsx) · `npm run build -w @triatlo/worker` gera `dist/main.mjs` (esbuild, único arquivo).
- Jobs com `SKIP LOCKED`, Web Push e motor adaptativo: Entregas 4–6 (ver `docs/ARCHITECTURE.md` §4 e §6).
- Sem domínio público.

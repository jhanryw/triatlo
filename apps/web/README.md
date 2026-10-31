# apps/web

Next.js 16 (App Router, TypeScript, Tailwind 4) e PWA. Mobile-first (tab bar inferior) com sidebar no desktop.

- Rotas (inglês): `/` (Hoje), `/workouts`, `/nutrition`, `/progress`, `/assistant`, `/settings`; API: `/api/health`, `/api/push/subscribe` (stub 501).
- PWA: `src/app/manifest.ts`, ícones em `public/icons` (gerados por `npm run icons`), `public/sw.js` (push + clique; sem cache).
- Web Push: UI e lógica prontas em `src/lib/push` e `src/components/PushSetup.tsx`, **inativas** até `NEXT_PUBLIC_PUSH_ENABLED=true` + chave VAPID + backend (Entrega 4). A permissão só é pedida no clique do botão.
- Supabase: `src/lib/supabase/*` (clientes browser/server com chave **pública**). Sem servidor, o app funciona e mostra "não configurado".
- Proibido aqui: chave privilegiada do Supabase, chave privada VAPID, envio de push, decisões esportivas fora de `packages/domain`.

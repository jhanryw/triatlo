# DEPLOYMENT — GitHub → CI → EasyPanel

> Estado: **documentado, ainda não executado.** Não há repositório remoto, servidor validado nem Supabase instalado (A-20, A-21). Nada aqui foi feito em produção. Pendências: Q-01, Q-02, Q-04, Q-14, Q-15.

## 1. Visão

```
git push (main) ──▶ GitHub Actions (quality · security · docker smoke test)
                └─▶ webhook do GitHub ──▶ EasyPanel: build por Dockerfile ──▶ container web / worker
```

O CI valida; o EasyPanel constrói e publica. Se o build no servidor consumir memória demais, trocar para: CI constrói e publica a imagem num registry privado e o EasyPanel usa fonte *Docker Image* com tag fixa (INFRASTRUCTURE §5).

## 2. Pré-requisitos (ações manuais do usuário)

1. Criar o repositório **privado** no GitHub (e autorizar o primeiro push — A-21/Q-14).
2. Servidor com EasyPanel, HTTPS e domínios (Q-01, Q-02). Recomendação de recursos em INFRASTRUCTURE §2.
3. Acesso do EasyPanel ao repositório privado: token do servidor (fonte GitHub) ou deploy key SSH somente leitura (fonte Git) — Q-04.
4. Em repositório de **organização**, criar a secret `GITLEAKS_LICENSE` (Q-15); em conta pessoal não é necessária.

## 3. Primeiro push e CI (quando autorizado)

```bash
git add -A && git status        # conferir: nenhum .env, nenhum segredo
git commit -m "chore: foundation (delivery 1)"
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

Conferir na aba Actions: `quality` (Node 22 e 24), `security` e `docker` verdes. **O workflow nunca foi executado**; falhas na primeira rodada são esperadas e informativas (principalmente o job `docker`, que não pôde ser testado localmente). Ativar *branch protection* em `main` exigindo esses jobs.

## 4. Serviços no EasyPanel

Dois serviços **App** no mesmo projeto, ambos com fonte GitHub, branch `main`, **caminho de build `/`** (contexto na raiz do monorepo) e tipo de build **Dockerfile**:

| Serviço | Dockerfile | Porta | Domínio | Réplicas |
|---|---|---|---|---|
| `triatlo-web` | `apps/web/Dockerfile` | 3000 (HTTP) | `app.<domínio>` com HTTPS | 1 |
| `triatlo-worker` | `apps/worker/Dockerfile` | 8081 (probe interno) | **nenhum** | **exatamente 1** |

Ativar *auto deploy* (webhook de push) em ambos. Os dois reconstroem a cada push (sem filtro por caminho nesta etapa).

### Variáveis de ambiente

Configurar **somente no EasyPanel**, nunca no repositório (modelo em `.env.example`). As variáveis do EasyPanel ficam disponíveis no build e no runtime.

`triatlo-web` (todas públicas e **embutidas no bundle no build** — alterar exige novo deploy/build):

| Variável | Valor na Entrega 1 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | vazias até o Supabase existir (o app funciona sem) |
| `NEXT_PUBLIC_PUSH_ENABLED` | `false` até a Entrega 4 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | vazia até a Entrega 4 |
| `APP_COMMIT_SHA` | opcional; exibido em `/api/health` |

`triatlo-worker`: `WORKER_TICK_SECONDS` (30), `WORKER_HEALTH_PORT` (8081), `LOG_LEVEL` (info). Nenhum segredo existe nesta entrega.

**Nunca** definir `SUPABASE_SECRET_KEY`/service role no serviço `web`; o CI e `npm run security:check` falham se o código do web referenciar credenciais privilegiadas.

### Limites de recursos sugeridos (a medir — H-03)
`triatlo-web`: reserva 256 MB, teto 512 MB (o **build** precisa de bem mais: ≥ 2 GB livres durante a construção). `triatlo-worker`: reserva 64 MB, teto 256 MB.

## 5. Verificação pós-deploy

- [ ] `https://app.<domínio>/api/health` → `200 {"status":"ok",...}`
- [ ] `https://app.<domínio>/manifest.webmanifest` com `display: standalone`
- [ ] `https://app.<domínio>/sw.js` com `Cache-Control: no-cache, no-store, must-revalidate`
- [ ] Logs do worker mostram `worker started` e o container fica *healthy* (probe `/healthz`)
- [ ] No iPhone: Safari → Compartilhar → Adicionar à Tela de Início → abrir pelo ícone; nenhum pedido de permissão aparece; em Configurações, Notificações mostra "ainda não configuradas"
- [ ] Reiniciar o worker (redeploy) e confirmar que volta a ficar *healthy*

## 6. Rollback

Reimplantar o commit anterior (EasyPanel → Deployments) ou, no modo por imagem, a tag anterior. Não há migrações de banco nesta etapa; a partir da Entrega 2 migrações são aplicadas por passo explícito, **após backup** (QUALITY_SECURITY §5).

## 7. Segurança do deploy

- Repositório privado; sem segredos no Git (varredura local + gitleaks no CI).
- Imagens Node com tag exata; containers executam como usuário não-root; ações do CI fixadas por SHA.
- Cabeçalhos de segurança no app (`next.config.ts`); HSTS efetivo apenas sob HTTPS. CSP restritiva fica para a Entrega 2 (precisa de nonces para o Next).
- Supabase: **não instalar** até validar a capacidade do VPS (INFRASTRUCTURE §3 e §7).

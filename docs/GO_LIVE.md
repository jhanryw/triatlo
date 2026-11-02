# GO_LIVE — colocar o Triatlo Inteligente em produção (um roteiro só)

Sem acesso SSH/EasyPanel da minha parte, estas são as únicas ações manuais. Nada aqui apaga volumes, bancos ou outros projetos. Os segredos nunca são impressos: vão do arquivo local para a área de transferência.

## 1. No Mac (1 min)
```bash
cd ~/Downloads/triatlo && git pull --ff-only
sh infra/supabase-existing/scripts/prepare-go-live-mac.sh
```
Gera em `~/.triatlo-secrets/` (modo 600): `supabase-kong-rotation.env`, `web.env`, `worker.env`, `vapid.env`.

## 2. No servidor, por SSH (uma execução; para uma vez, no passo do EasyPanel)
```bash
git clone --depth 1 https://github.com/jhanryw/triatlo.git ~/triatlo-ops 2>/dev/null || true
bash ~/triatlo-ops/infra/supabase-existing/scripts/go-live-server.sh
```
Ele atualiza o checkout, confirma o container `qarvon_supabase-triatlo-db-1` pelo guard, faz backup (banco + Storage) com verificação e ensaio de restauração, grava o marcador de persistência e **para**. Aí, no EasyPanel, serviço `supabase-triatlo` → Environment:
1. apague as 4 linhas `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DASHBOARD_PASSWORD`;
2. no Mac: `pbcopy < ~/.triatlo-secrets/supabase-kong-rotation.env`, cole no lugar; salve; **Deploy uma vez** e espere ficar saudável;
3. volte ao terminal e dê Enter. O script confere que o marcador sobreviveu (se não, para e não aplica nada), aplica as migrations 1–9, roda os testes SQL/RLS no banco real e termina.

Cópia externa do backup (no Mac): `scp -r <seu-usuario-ssh>@82.25.68.222:triatlo-backups ~/Downloads/triatlo-backups-offsite`

## 3. EasyPanel — web e worker
- **web** → Environment: apague `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (a chave `sb_publishable_` não funciona no Kong e tem prioridade sobre a anon). `pbcopy < ~/.triatlo-secrets/web.env` e cole. **Deploy** (fonte GitHub, branch `main`, Dockerfile `apps/web/Dockerfile`; hoje a produção ainda roda a versão antiga, sem `/login`).
- **worker** (serviço novo no projeto `qarvon`, tipo App): GitHub `jhanryw/triatlo`, `main`, build path `/`, Dockerfile `apps/worker/Dockerfile`, **sem domínio**. `pbcopy < ~/.triatlo-secrets/worker.env` e cole em Environment. Deploy.
- Depois: `pbcopy < /dev/null`.

## 4. No Mac — conta e provas por HTTPS
```bash
API=https://qarvon-supabase-triatlo.uxxkgy.easypanel.host
bash infra/supabase/scripts/create-admin-user.sh --api-url $API
bash infra/supabase/scripts/smoke-test.sh --api-url $API --key-var ANON_KEY --stack kong --login
bash infra/supabase/scripts/integration-test.sh --api-url $API --key-var ANON_KEY
curl -s https://qarvon-triatlo.uxxkgy.easypanel.host/api/health/supabase   # esperado: keyKind legacy_anon, keyAccepted true
```

## 5. Usar
Abra `https://qarvon-triatlo.uxxkgy.easypanel.host`, entre, e em Configurações: fuso, janelas de treino, aprovar as regras. Importe o `export.xml` (ou GPX/TCX). No iPhone: adicione à Tela de Início, abra pelo ícone e ative as notificações.

## 6. IA de refeições (quando você decidir custo e modelo)
No serviço `web`, adicione `OPENAI_API_KEY` e `AI_MODEL` (sem valor padrão de propósito), faça Deploy e autorize o envio de fotos em Configurações → IA e privacidade.

## Risco residual conhecido
`POSTGRES_PASSWORD` e as demais chaves internas continuam as do template: a porta 5432 não está exposta à Internet (verificado), então o vetor explorável de fora era o `JWT_SECRET`, que este roteiro troca. Trocar a senha do banco exige o `DROP SCHEMA _supavisor` do procedimento oficial (apaga só metadados do pooler); fica para uma janela com sua autorização específica.

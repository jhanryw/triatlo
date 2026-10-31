# PRODUCTION_VALIDATION — o que foi verificado em produção (2026-10-31)

> Verificações feitas **de fora**, por HTTPS, sem acesso ao EasyPanel e sem alterar nada. Nenhuma credencial foi impressa. Hosts informados pelo proprietário:
> Web `https://qarvon-triatlo.uxxkgy.easypanel.host` · Supabase `https://qarvon-supabase-triatlo.uxxkgy.easypanel.host`.

## Resultado resumido

| # | Item | Resultado |
|---|---|---|
| 1 | Web no ar | ✅ `/api/health`, `/manifest.webmanifest`, `/sw.js`, `/settings` respondem 200 sob HTTPS |
| 2 | **Supabase em produção é a stack deste repositório?** | ❌ **Não.** O gateway responde `server: kong/3.9.1` (a nossa usa Envoy). Provavelmente o **template do EasyPanel** |
| 3 | **Chaves** | 🔴 **CRÍTICO:** nenhuma chave gerada para este projeto é aceita (todas dão 401) **e** a chave anon pública de demonstração do upstream **é aceita** (`/auth/v1/health` e `/rest/v1/` → 200). Logo o servidor usa o **`JWT_SECRET` padrão público**: qualquer pessoa na internet consegue forjar chaves, inclusive `service_role` (acesso administrativo). Não testei além da leitura com a chave anon |
| 4 | Superfície pública | ⚠️ Sem restrição de caminho: `/functions/v1/hello` responde 200 **sem chave** ("Hello from Edge Functions!"); `/storage/v1/status` 200; `/` 401 (Basic Auth/Kong) |
| 5 | CORS | ✅ `access-control-allow-origin: *` e cabeçalhos `apikey,authorization,content-type` permitidos (pré-voo `OPTIONS` 200) |
| 6 | **Variáveis públicas no build do Next.js** | ❌ **Não incorporadas.** `/settings` mostra "Banco de dados: não configurado" e os bundles não contêm o host do Supabase nem chave. Causa: `NEXT_PUBLIC_*` é embutida só **no build** e o EasyPanel não repassou as variáveis como *build args* |
| 7 | Conexão app → Supabase | ⏸ Não verificável até 6 ser corrigido (correção de código pronta, abaixo) |
| 8 | Volumes, isolamento, persistência, backup | ⏸ **Não verificáveis sem acesso ao servidor**, e sem sentido enquanto o item 3 existir |
| 9 | Credenciais de demonstração do painel (`supabase` / senha padrão) | ✅ recusadas (401) — mas o JWT padrão continua valendo |

> Roteiro ordenado e atualizado: [SUPABASE_RUNBOOK.md](SUPABASE_RUNBOOK.md). Reverificação em 2026-10-31 (mais tarde): **nada mudou** — gateway ainda Kong, chave demo ainda aceita, web ainda no build antigo.

## Ações imediatas (suas — exigem o EasyPanel)

1. **Agora, 2 minutos:** no EasyPanel, projeto `qarvon` → serviço **`supabase-triatlo`** → **Stop** (não "Destroy"). Enquanto estiver no ar com o JWT padrão, qualquer pessoa pode criar usuários, enviar arquivos e consultar a API como administrador. Ainda **não há dado real**, então o risco hoje é de abuso, não de vazamento. Não mexa nos outros serviços do projeto `qarvon`.
2. **Substituir** pela stack deste repositório (Envoy, segredos únicos, sem portas, só 3 caminhos públicos) seguindo [SUPABASE_EASYPANEL.md](SUPABASE_EASYPANEL.md). Como o serviço atual está vazio (criado a partir do template), a forma mais limpa é **apagar** `supabase-triatlo` (isso é destrutivo: confirme que não há nada nele e que está **parado**) e criar o serviço **Compose** com **o mesmo nome `supabase-triatlo`**, para manter o host `…-supabase-triatlo…`. As três URLs já estão preenchidas no seu arquivo local de segredos (`~/.triatlo-secrets/supabase.env`) — falta só colar o conteúdo no `.env` do serviço (`pbcopy < ~/.triatlo-secrets/supabase.env`).
   - Alternativa menos limpa: manter o template e trocar `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` (e a senha do Postgres, o que exige recriar o volume). Não recomendo: diverge do repositório, do CI e do guia.
3. **No serviço `web`:** nada a recriar. Defina (ou confirme) `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (a chave `sb_publishable_…` da **nova** stack) e faça **Deploy** do código novo (`main`): agora a configuração é lida **em runtime** — um *restart* basta para mudar. Confira `https://qarvon-triatlo.uxxkgy.easypanel.host/api/health` (`config.supabaseConfigured: true`) e `/api/health/supabase` (`keyAccepted: true`).

## O que eu faço em seguida (depois do passo 2)
`smoke-test.sh` (superfície pública), criação da conta única, teste de persistência (reiniciar `db` e o stack), `migrate.sh --container <db>` para aplicar o esquema, teste de backup/restauração (`infra/backup/RESTORE.md` §B) **antes de qualquer dado real de saúde**.

## Correções de código feitas nesta rodada
- Configuração pública (Supabase, push) lida **em runtime** no servidor e entregue aos componentes de cliente como props — não depende mais de build args.
- `/api/health` informa só **booleanos** de configuração; novo `/api/health/supabase` testa, do servidor, o alcance do gateway e a aceitação da chave (sem expor URL nem chave).
- O app **recusa** uma chave privilegiada (`sb_secret_…` ou JWT `service_role`) colocada na variável pública.
- Esquema do banco, RLS e testes: [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

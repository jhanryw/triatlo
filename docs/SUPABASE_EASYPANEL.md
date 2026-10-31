# SUPABASE_EASYPANEL — Criar o Supabase dedicado e conectar o app

> Estado (2026-10-31): **preparado, NÃO implantado.** Nada foi aplicado ao EasyPanel, nenhum container foi criado ou reiniciado. Docker não existe na máquina de desenvolvimento, então o compose adaptado **nunca foi executado**: as verificações feitas são estruturais (`npm run supabase:check`). Itens marcados ⚠️ são suposições sobre o EasyPanel que só você consegue confirmar na tela dele; se algo divergir, pare e me diga o que a tela mostra.
>
> Stack: oficial `supabase/supabase` tag `self-hosted/v0.8.3` (commit `bc27d26…`), imagens fixadas. Detalhes e diferenças: [infra/supabase/UPSTREAM.md](../infra/supabase/UPSTREAM.md).

## 0. O que já está pronto

| Item | Onde | Estado |
|---|---|---|
| Compose oficial adaptado (sem portas publicadas, sem `container_name`, volumes nomeados, nome de projeto único) | `infra/supabase/docker-compose.yml` | ✅ escrito, verificação estrutural no CI |
| `.env.example` seguro (cadastro público **desligado**, telefone/anônimo **desligados**, IA do Studio **vazia**, senhas vazias) | `infra/supabase/.env.example` | ✅ |
| **Segredos únicos gerados localmente** com os scripts oficiais | `~/.triatlo-secrets/supabase.env` (modo 600, **fora do repositório**) | ✅ gerados; **valores nunca exibidos**; falta preencher 3 URLs |
| Backup agendado (banco + roles + arquivos) | serviço `backup` no compose | ✅ escrito, ⚠️ não executado |
| Restauração | `infra/backup/RESTORE.md` | ⚠️ rascunho a ensaiar |
| Testes da superfície pública / criação da conta única | `infra/supabase/scripts/{smoke-test,create-admin-user}.sh` | ✅ escritos, ⚠️ não executados contra servidor |

Conferências feitas contra o upstream: todas as variáveis `${…}` do compose estão no `.env`; nomes de variáveis do cliente Supabase do app (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) batem com `apps/web/src/lib/supabase/env.ts`; o compose usa a sintaxe de interpolação aninhada (`${A:-${B}}`), que exige **Docker Compose v2** no servidor — confirme com `docker compose version` no terminal do servidor ⚠️.

## 1. Pré-requisitos antes de tocar no EasyPanel

1. ✅ **Código enviado** para `main` em https://github.com/jhanryw/triatlo (CI verde, run #3). O EasyPanel faz o deploy do Supabase **a partir deste repositório** (os arquivos de `infra/supabase/volumes/` precisam existir no checkout — existem).
2. **Repositório público (decisão A-23).** Por isso: nunca commite segredos (o CI roda gitleaks no histórico inteiro e o `security-check`); a configuração de infraestrutura é pública, mas **sem credenciais** — elas existem só em `~/.triatlo-secrets/` e no `.env` do EasyPanel.
3. **Acesso do EasyPanel ao repositório** ✅ (docs do EasyPanel): repositório público não precisa de token. Use a fonte *Git* com a URL HTTPS `https://github.com/jhanryw/triatlo.git`; não é necessária deploy key.
4. **Guardar o arquivo de segredos** num gerenciador de senhas. Ele é a única cópia. Sem ele, restaurar o banco é impossível (a senha do Postgres e as chaves JWT ficam gravadas nos dados). Para conferir sem mostrar valores:

   ```bash
   sh infra/supabase/scripts/prepare-env.sh --status
   ```

## 2. Criar projeto e serviços no EasyPanel (sem implantar ainda)

Nomes sugeridos: projeto **`triatlo`**; serviços **`supabase`** (Compose), **`web`** e **`worker`** (App). Use um projeto só para este app: nada é reutilizado de outros projetos.

### 2.1 Serviço Compose `supabase`
1. *Create Service → Compose.* Fonte **Git**: URL `https://github.com/jhanryw/triatlo.git`, branch `main`, **build path `/infra/supabase`**, arquivo `docker-compose.yml`.
2. **Não clique em Deploy.** Abra o aviso de compatibilidade do EasyPanel: ele não deve apontar `ports:` nem `container_name:` (o compose adaptado não tem nenhum). ⚠️ Se aparecer qualquer aviso, copie o texto para mim.
3. **Domínios** (aba *Domains*) — **somente** estes três, todos com o **mesmo host gerado pelo EasyPanel**, serviço `api-gw`, porta **8000**, protocolo HTTP, HTTPS ativado:

   | Caminho | Para quê |
   |---|---|
   | `/auth/v1` | Autenticação |
   | `/rest/v1` | API de dados (protegida por RLS) |
   | `/storage/v1` | Fotos privadas (URLs assinadas) |

   Não crie domínio para `db`, `supavisor`, `studio`, `meta`, `realtime`, `functions`, `backup`. Resultado: PostgreSQL, pooler, Studio, postgres-meta, Realtime e Edge Functions **não têm rota pública**.
   - ⚠️ Confirmar que o EasyPanel aceita várias entradas com o mesmo host e caminhos diferentes, e que o caminho funciona como **prefixo** sem remover o prefixo da URL (o gateway espera `/auth/v1/...` completo). O `smoke-test.sh` valida isso depois do deploy. Se o EasyPanel não oferecer caminho, a alternativa é um único domínio `/`: então o Studio fica atrás do Basic Auth do próprio gateway (usuário `triatlo_admin` + `DASHBOARD_PASSWORD`) — funciona, mas é menos restritivo.
   - ⚠️ Anote o host gerado (ex.: `…easypanel.host`). **Não invente**: copie exatamente o que a tela mostrar. Você pode me passar o texto.
4. **Studio:** não é exposto. A administração normal é feita por migrações SQL versionadas e pelo script `create-admin-user.sh`. Se um dia precisar do Studio, crie **temporariamente** um domínio separado para `api-gw:8000` protegido por **Basic Auth do EasyPanel** (primeira camada) — o gateway ainda exige o Basic Auth do Studio (`triatlo_admin` + `DASHBOARD_PASSWORD`) como segunda camada — e remova o domínio ao terminar.

### 2.2 Serviço `web` (App)
Fonte GitHub (`jhanryw/triatlo`, branch `main`, **build path `/`**), build **Dockerfile** `apps/web/Dockerfile`, porta **3000**, domínio gerado pelo EasyPanel com HTTPS. **Não implante ainda**: você só precisa do host gerado.

### 2.3 Serviço `worker` (App) — depois
Mesmo repositório, `apps/worker/Dockerfile`, **sem domínio**. Fica para a Etapa 3/5.

## 3. Preencher as URLs (com os hosts que o EasyPanel gerou)

Com os dois hosts em mãos (`API_HOST` e `APP_HOST`, **sem** barra final):

```bash
sh infra/supabase/scripts/prepare-env.sh --urls-only --api-url https://API_HOST --app-url https://APP_HOST
```

Isso só altera `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL` (= API + `/auth/v1`) e `SITE_URL` no arquivo local e reporta o estado sem mostrar segredos. A saída final deve mostrar **nenhum `TODO`/`MISSING`/`WARNING`**.

## 4. Variáveis: o que vai para onde

| Variável | `supabase` (Compose) | `web` | `worker` | Observação |
|---|:--:|:--:|:--:|---|
| Todo o `supabase.env` | ✔ | ✖ | ✖ | Cole inteiro no `.env` do serviço `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` = `https://API_HOST` | – | ✔ (**build** e runtime) | – | Público |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = valor de `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) | – | ✔ (**build** e runtime) | – | **Público por desenho**; só funciona com RLS |
| `NEXT_PUBLIC_PUSH_ENABLED`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | – | ✔ | – | `false`/vazio até a Etapa 5 |
| `SUPABASE_SECRET_KEY` | (já no `.env`) | **✖ nunca** | ✔ (Etapa 3/4) | Só servidor |
| `SERVICE_ROLE_KEY`, `JWT_SECRET`, `JWT_KEYS`, `POSTGRES_PASSWORD`, `DASHBOARD_PASSWORD` | ✔ | **✖ nunca** | ✖ | Internos |

- O Next.js lê **apenas** `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (não há nenhuma variável de Supabase de servidor no app web). Como são embutidas no *build*, defina-as no serviço `web` **antes** de implantar; alterá-las exige novo build.
- Copiar só o valor público para a área de transferência, sem mostrá-lo:

  ```bash
  grep '^SUPABASE_PUBLISHABLE_KEY=' ~/.triatlo-secrets/supabase.env | cut -d= -f2- | tr -d '\n' | pbcopy
  ```

  Limpe depois com `pbcopy < /dev/null`. Para o `.env` completo do `supabase`: `pbcopy < ~/.triatlo-secrets/supabase.env`, cole na aba de ambiente do serviço (botão para criar/salvar o arquivo `.env`) e limpe a área de transferência em seguida.
- **Conexão do worker com o banco:** o worker é outro serviço (outra rede Docker) e a porta do PostgreSQL **não** é publicada. Proposta (P-23): o worker usa a **API HTTPS do Supabase com a chave secreta** (chamadas a funções SQL `service_role`-only), sem abrir o banco. ⚠️ Se o EasyPanel permitir resolver `db` entre serviços, a conexão direta continua possível — a confirmar na Etapa 3.

## 5. Implantar o Supabase (só depois da sua autorização)

1. Conferir: repositório enviado (já está); `.env` colado com as 3 URLs; domínios `/auth/v1`, `/rest/v1`, `/storage/v1` criados; **nenhuma** porta publicada.
2. Clique **Deploy** no serviço `supabase`. A primeira subida leva alguns minutos (o banco inicializa os roles e o pooler migra).
3. Esperado: todos os serviços *healthy* (`db`, `auth`, `rest`, `storage`, `meta`, `studio`, `api-gw`, `supavisor`, `realtime`, `functions`, `imgproxy`); `backup` em execução. Logs do `backup` mostram `backup sidecar started` e, ~60 s depois, o primeiro backup.
4. **Se algo falhar, não use "Destroy"/reset** (apagaria os volumes). Copie os logs e me envie.

## 6. Verificação (da sua máquina)

```bash
bash infra/supabase/scripts/smoke-test.sh --api-url https://API_HOST
```

Passa quando: Auth e REST respondem **só com a chave**; `/` (Studio), `/pg/`, `/functions/v1/` e `/realtime/…` **não** são servidos; cadastro público é **recusado**. Em seguida, **crie a sua conta única** (cadastro continua desligado; é pela API administrativa, com senha digitada em modo oculto):

```bash
bash infra/supabase/scripts/create-admin-user.sh --api-url https://API_HOST
bash infra/supabase/scripts/smoke-test.sh --api-url https://API_HOST --login
```

Confirme também, de fora do servidor, que as portas estão fechadas: `nc -vz IP_DO_SERVIDOR 5432`, `6543` e `8000` devem **falhar**.

## 7. Persistência e backup

**Teste de persistência (obrigatório antes de considerar concluído):**
1. Com a conta criada e o `--login` passando, reinicie **somente o `db`** (EasyPanel → serviço → reiniciar container do `db`, ou `docker restart <container-db>`). Rode `smoke-test.sh --login` de novo: o login tem que continuar funcionando.
2. Faça **Stop → Deploy** do serviço Compose inteiro (nunca *Destroy*). Rode de novo. Os volumes `db-data`, `storage-data` e `db-config` precisam ter sobrevivido: `docker volume ls | grep triatlo-supabase`.
3. Registre o resultado em `docs/DECISIONS.md`.

**Backup:** o serviço `backup` grava, a cada dia às 06:00 UTC (+ 1 execução ~60 s após subir), em `/backups` (volume `db-backups`): dump do banco, roles, arquivo do Storage, checksums; retenção de 14 dias. Verifique: `docker exec <container-backup> sh -c 'cat /backups/LAST_STATUS; ls -lh /backups'`.

**Pendente (não declarar como feito):** a **cópia externa automatizada** — depende do destino (Q-03). Opções em `infra/backup/RESTORE.md` §D. E o **ensaio de restauração** (§B) precisa ser executado e registrado.

## 8. Autenticação para uso pessoal (já embutida)

`DISABLE_SIGNUP=true` desde o primeiro boot; login por e-mail/senha; telefone, anônimos e provedores sociais **desligados**; `ENABLE_EMAIL_AUTOCONFIRM=false` (a sua conta é criada já confirmada pela API administrativa). **Sem SMTP** (Q-05): recuperação de senha e troca de e-mail não funcionarão até configurar um provedor — guarde bem a senha. MFA/TOTP está disponível no GoTrue (padrão ativo) e será avaliado na Etapa 4.

## 9. Conectar o serviço web (Etapa 3, depois do Supabase saudável)

1. No serviço `web`, defina `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (tabela §4) e as flags de push como `false`.
2. Implante o `web`. Verifique `https://APP_HOST/api/health`; em *Configurações → Sistema* o banco deve aparecer como **Configurado** (hoje o app só detecta as variáveis; a conexão autenticada de verdade chega com o login na Etapa 4).
3. O navegador chamará `https://API_HOST/...` (outra origem). O gateway trata CORS ⚠️ — o primeiro teste real de login pelo app confirma.

## 10. Hipóteses a validar na primeira implantação

- ⚠️ EasyPanel: fonte Git do Compose resolve `./volumes/...` a partir do build path; clone HTTPS do repositório público funciona; múltiplos domínios com caminho para o mesmo serviço; domínio gerado disponível para serviço Compose.
- ⚠️ `docker compose version` ≥ v2 no servidor; versão do Docker suficiente para as imagens (`supabase/postgres:17`).
- ⚠️ A imagem do banco contém `openssl` (necessário só se ativar criptografia dos backups) — conferir com `docker exec <container-backup> which openssl`.
- ⚠️ Recursos: 11 containers + app + worker + build do Next. Você afirmou que o VPS comporta; vamos observar memória nos primeiros dias (`docker stats`). Reduzir (sem `functions`/`realtime`) é possível, mas diverge do upstream.

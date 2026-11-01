# SUPABASE_RUNBOOK — substituir o Supabase e aplicar as migrations (passos operacionais)

> ⚠️ **SUPERADO pela decisão A-24 (2026-10-31):** mantemos a instalação existente (Kong). Este documento descreve a stack Envoy de referência (`infra/supabase`), **não implantada**. O roteiro vigente é [SUPABASE_EXISTING.md](SUPABASE_EXISTING.md).

> Estado em 2026-10-31: o Supabase publicado em `qarvon-supabase-triatlo…` ainda é o **template antigo (Kong) com o JWT padrão público**; nada foi substituído, nenhuma migration foi aplicada. Este roteiro só tem passos que dependem de você no EasyPanel/servidor. Eu não tenho acesso ao painel nem ao servidor: **nomes de containers só existem depois do deploy** — o `server-preflight.sh` os imprime; não os adivinhe.

Convenções: `API` = `https://qarvon-supabase-triatlo.uxxkgy.easypanel.host` · `APP` = `https://qarvon-triatlo.uxxkgy.easypanel.host`. Nenhum passo reinicia ou remove serviços de outros projetos.

## A. Substituir a instalação insegura (EasyPanel)

1. **Parar** o serviço atual `supabase-triatlo` (projeto `qarvon`) → botão **Stop**. Só ele.
2. Confirmar que ele não tem dado nenhum que você queira (foi criado a partir do template e nunca teve migration). Então **apagá-lo** (destrutivo; só depois de parado). Isso libera o nome e o host.
3. Criar o serviço **Compose** com o **mesmo nome `supabase-triatlo`** no projeto `qarvon`: fonte Git, URL `https://github.com/jhanryw/triatlo.git`, branch `main`, **build path `/infra/supabase`**, arquivo `docker-compose.yml`. **Não implante ainda.**
4. Aba de ambiente: colar o `.env` (`pbcopy < ~/.triatlo-secrets/supabase.env` no seu Mac; as 3 URLs já estão nele) e salvar como arquivo `.env`. Depois limpar a área de transferência (`pbcopy < /dev/null`).
5. *Domains*: **três** entradas no mesmo host `qarvon-supabase-triatlo.uxxkgy.easypanel.host`, serviço `api-gw`, porta 8000, HTTPS: caminhos `/auth/v1`, `/rest/v1`, `/storage/v1`. Nenhum domínio para os outros serviços.
6. Conferir o aviso de compatibilidade do EasyPanel (não deve citar `ports` nem `container_name`). Se citar, **pare e me envie o texto**.
7. **Deploy.** Aguarde alguns minutos.

## B. Identificar serviço e container PostgreSQL exatos (terminal do servidor, SSH — somente leitura)

```bash
curl -fsSL https://raw.githubusercontent.com/jhanryw/triatlo/main/infra/supabase/scripts/server-preflight.sh -o server-preflight.sh
less server-preflight.sh        # leia antes de executar: ele só lista (docker ps/inspect/port), não altera nada
bash server-preflight.sh
```

Ele imprime o projeto, o container `db` (+ estado `healthy`), o container `backup/ops`, o gateway (deve ser **Envoy**, não Kong), os volumes e se **alguma porta 5432/6543/8000/8443 está publicada no host** (deve dizer que nenhuma está). **Me envie a saída** (ela não contém segredos). Os nomes que ela imprimir são os que valem daqui em diante; abaixo uso `<db>` e `<ops>`.

## C. Validar gateway, Auth e Storage (do seu Mac)

```bash
bash infra/supabase/scripts/smoke-test.sh --api-url https://qarvon-supabase-triatlo.uxxkgy.easypanel.host
bash infra/supabase/scripts/create-admin-user.sh --api-url https://qarvon-supabase-triatlo.uxxkgy.easypanel.host   # sua conta única (senha oculta)
bash infra/supabase/scripts/smoke-test.sh --api-url https://qarvon-supabase-triatlo.uxxkgy.easypanel.host --login
```

Critério: `ALL CHECKS PASSED`, `Public sign-up is rejected`, `Studio (/)` não servido. E, de fora, `nc -vz <IP-do-servidor> 5432` (e 6543, 8000) deve **falhar**.

## D. Backup **antes** de qualquer alteração de schema

```bash
docker exec -it <ops> bash /backup.sh --once       # um backup imediato; sai com o status
docker exec <ops> sh -c 'cat /backups/LAST_STATUS; ls -lh /backups'     # deve começar com "ok"
```

Depois, o **ensaio de restauração** de `infra/backup/RESTORE.md` §B (banco descartável dentro do mesmo servidor; não toca no banco real). Anote o resultado.

## E. Migrations — revisão, simulação, aplicação (dentro do container `<ops>`, **sem publicar a porta do banco**)

O container `backup` também é o container de operações: já tem `psql`, as variáveis `PG*` apontando para o `db` e a pasta `supabase/` do repositório montada somente-leitura em `/supabase`.

```bash
docker exec -it <ops> bash
ls /supabase/migrations                     # devem aparecer as 7 migrations; se a pasta não existir, veja "Plano B"
bash /supabase/migrate.sh --dry-run         # lista o que seria aplicado, não altera nada
bash /supabase/migrate.sh --status          # nada aplicado ainda: tudo "pending"
```

**Só depois da sua autorização explícita** (me diga "aplicar"), no mesmo terminal:

```bash
bash /supabase/migrate.sh                   # uma transação por arquivo, checksum registrado; recusa statements destrutivos
bash /supabase/migrate.sh --status          # as 7 devem estar "applied ... checksum ok"
```

*Plano B* (se `/supabase` não existir no container): no host do servidor, `git clone --depth 1 https://github.com/jhanryw/triatlo.git` e, dentro do clone, `bash supabase/migrate.sh --container <db> --dry-run` e depois sem `--dry-run` (usa `docker exec`; também sem publicar porta).

## F. Testes SQL no banco real (seguros: tudo em transação revertida; o schema auxiliar `tests` é removido no fim)

```bash
bash /supabase/tests/run.sh --production    # dentro de <ops>: 8 arquivos devem dar PASS
```

O modo `--production` **recusa** rodar se `auth.users`, `storage.objects` ou o histórico de migrations não existirem, **não** cria stand-ins e **não** aplica migrations. Verificado em banco descartável: o esquema fica idêntico antes e depois.

## G. Integração ponta a ponta (do seu Mac)

```bash
bash infra/supabase/scripts/integration-test.sh --api-url https://qarvon-supabase-triatlo.uxxkgy.easypanel.host
```

Faz login com a sua conta, grava e lê **um** check-in de teste (data 2000-01-01) e **um** objeto de teste no bucket privado, prova que `anon` não lê nada, que não se escreve em nome de outro usuário, que as chaves de push e a fila são inacessíveis ao usuário e que o Storage é privado; remove os dois itens no fim.

## H. Persistência após reinício

Com G passando: reinicie **só o container `<db>`** (EasyPanel, ou `docker restart <db>`) e rode `smoke-test.sh --login` + `integration-test.sh` de novo; depois **Stop → Deploy** do serviço Compose (nunca *Destroy*) e repita. `docker volume ls | grep -i supabase` deve mostrar `db-data` e `storage-data` do projeto.

## I. App Next.js

No serviço `web`: `NEXT_PUBLIC_SUPABASE_URL=https://qarvon-supabase-triatlo.uxxkgy.easypanel.host` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = valor de `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`, chave **pública**; copie sem exibir: `grep '^SUPABASE_PUBLISHABLE_KEY=' ~/.triatlo-secrets/supabase.env | cut -d= -f2- | tr -d '\n' | pbcopy`). **Deploy** do web (o código novo lê em runtime). Conferir:

```bash
curl -s https://qarvon-triatlo.uxxkgy.easypanel.host/api/health            # config.supabaseConfigured: true
curl -s https://qarvon-triatlo.uxxkgy.easypanel.host/api/health/supabase   # reachable: true, keyAccepted: true
```

## Se algo falhar
Não use *Destroy*/reset e não reaplique migrations "para ver se passa". Copie o erro e a saída do `--status` e me envie. Migration aplicada nunca é editada: o runner interrompe por checksum.

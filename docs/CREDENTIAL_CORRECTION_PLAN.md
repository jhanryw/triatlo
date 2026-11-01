# CREDENTIAL_CORRECTION_PLAN — correção coordenada das credenciais demonstrativas (PLANO, nada executado)

> Estado em 2026-10-31: a inspeção do servidor (feita pelo proprietário) **confirmou credenciais demonstrativas em vários containers, incluindo JWT, PostgreSQL e chaves de API**. Mantemos o Supabase Kong existente (A-24). Este plano **não foi executado**: cada janela exige autorização explícita (portões G1–G3 abaixo). Nenhum dado pessoal real pode ser armazenado antes de a correção e o teste de persistência estarem concluídos.
>
> Limite honesto: a lista exata de variáveis marcadas como `DEFAULT DEMO VALUE` está na saída da inspeção, que eu ainda não vi. Os nomes abaixo são os do compose oficial do upstream; **os nomes da saída da inspeção prevalecem**.

## 1. O que muda junto (mapa de dependências)

| Segredo (nome upstream) | Quem usa | Efeito da troca | Como trocar | Risco |
|---|---|---|---|---|
| `JWT_SECRET` | Auth, REST, Realtime, Storage, Functions, Studio, Supavisor (verificam/assinam tokens) | Tokens antigos deixam de valer; **`ANON_KEY` e `SERVICE_ROLE_KEY` precisam ser reassinadas com o novo segredo** | Variável de ambiente + recriação de toda a stack | Baixo: não há usuários nem sessões reais |
| `ANON_KEY`, `SERVICE_ROLE_KEY` | Kong (chave de acesso por consumidor), Studio, Storage, Functions | Chaves antigas (públicas, de demonstração) passam a ser **recusadas** | Mesma janela que `JWT_SECRET` | Baixo. O `web` precisa receber a nova `ANON_KEY` |
| `POSTGRES_PASSWORD` | Papéis do banco (12, ver abaixo) e **todas** as URLs de banco dos serviços; tenant do Supavisor | Se só o `.env` mudar, os serviços **não autenticam** (a senha dos papéis vive no banco). Se só o banco mudar, idem | **Ordem obrigatória:** `ALTER USER` dos papéis → `.env` → recriar. Procedimento oficial (`utils/db-passwd.sh`), que inclui `DROP SCHEMA _supavisor CASCADE` | Médio (janela de indisponibilidade curta); **destrutivo apenas para metadados do pooler**, recriados na subida |
| `DASHBOARD_PASSWORD` | Basic Auth do Kong (Studio) | Só a credencial do painel | Ambiente + recriação | Baixo |
| `SECRET_KEY_BASE` | Realtime, Supavisor | Chave de cifra de comunicação | Ambiente | **Rotação não documentada** pelo upstream |
| `VAULT_ENC_KEY` | Supavisor (config cifrada em `_supavisor`) | Dados cifrados antigos ilegíveis | Naturalmente coberto se `_supavisor` for recriado (passo da senha do banco) | Médio, só junto com o `DROP SCHEMA _supavisor` |
| `PG_META_CRYPTO_KEY` | Studio/postgres-meta (cifra de strings de conexão) | Sem dado persistente conhecido | Ambiente | **Não documentado**; baixo |
| `REALTIME_DB_ENC_KEY` | Realtime (campos cifrados em `_realtime.tenants`) | Linhas existentes podem ficar ilegíveis; exige recriar/re-semear o tenant | Ambiente **+** tratamento do tenant | **Não documentado; o mais arriscado** |
| `LOGFLARE_*`, `S3_PROTOCOL_*`, `MINIO_*` | Logs/analytics, endpoint S3 do Storage | Credenciais de serviços internos | Ambiente | Baixo; depende de os serviços existirem |

Papéis do banco cuja senha muda no passo oficial: `anon, authenticated, authenticator, dashboard_user, pgbouncer, postgres, service_role, supabase_admin, supabase_auth_admin, supabase_functions_admin, supabase_replication_admin, supabase_storage_admin` (`supabase_read_only_user` não tem senha).

## 2. Pré-condições (todas antes de qualquer troca)

1. Inspeção reexecutada com o script corrigido; banco identificado como **`qarvon_supabase-triatlo-db-1`** e validado pelo guard (não por nome).
2. **Backup completo + cópia fora do servidor + ensaio de restauração** concluídos (`SUPABASE_EXISTING.md` §4).
3. **Teste de persistência do redeploy** (`persistence-marker.sh`, portão G1): como trocar credenciais **é um redeploy**, precisamos saber antes se um redeploy preserva os dados (ver §3 de `SUPABASE_EXISTING.md`, risco dos volumes dentro do diretório de código).
4. Valores novos já existem localmente (`~/.triatlo-secrets/supabase.env`, gerados pelo gerador oficial; nunca impressos): `JWT_SECRET`/`ANON_KEY`/`SERVICE_ROLE_KEY` (compatibilidade com o Kong verificada: HS256, papéis corretos, 5 anos), `DASHBOARD_PASSWORD`, `SECRET_KEY_BASE`, `REALTIME_DB_ENC_KEY`, `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY`, `LOGFLARE_*`, `S3_PROTOCOL_*`, `MINIO_ROOT_PASSWORD`, `POSTGRES_PASSWORD` (hex de 32 caracteres, sem caracteres especiais, como o utilitário oficial exige). **Não** se usam as chaves opacas/assimétricas da stack Envoy.
5. Nenhum dado pessoal real no sistema (confirmado: 0 usuários).

## 3. Sequência da janela de correção (portão G2 — autorização explícita)

| # | Passo | Onde | Observação |
|---|---|---|---|
| 1 | Backup final + checksum | servidor (`backup-existing.sh`) | repetir mesmo com o anterior recente |
| 2 | `ALTER USER` dos 12 papéis para a nova `POSTGRES_PASSWORD` + `DROP SCHEMA _supavisor CASCADE` + recriar `_supavisor` | servidor, `docker exec` no container validado | **a preparar após ver a inspeção**: script com o guard, senha lida por stdin do arquivo local, nunca impressa. A partir daqui, qualquer conexão nova com a senha antiga falha ⇒ manter a janela curta |
| 3 | Editar o ambiente do serviço `supabase-triatlo`: **todas** as variáveis marcadas como padrão, de uma vez, e salvar | EasyPanel | valores do arquivo local; sem exibir (`pbcopy`) |
| 4 | **Um único Deploy** | EasyPanel | recria os containers que mudaram (`docker compose up -d`) |
| 5 | Aguardar `healthy` e verificar | servidor + Mac | ver §4 |
| 6 | Atualizar `NEXT_PUBLIC_SUPABASE_ANON_KEY` no `web` e reiniciar | EasyPanel | a chave de demonstração é recusada pelo app |

Itens de baixa certeza (`REALTIME_DB_ENC_KEY`, `SECRET_KEY_BASE`, `PG_META_CRYPTO_KEY`): **não entram na janela** a menos que a inspeção os marque como padrão **e** decidamos o tratamento (Realtime não é usado pelo app; alternativa a avaliar: manter o risco residual documentado, já que exige acesso ao banco para explorar).

## 4. Verificação depois da janela
- Chave de demonstração recusada (`401`), chave nova aceita (`200`): `smoke-test.sh --key-var ANON_KEY --stack kong`.
- `inspect-existing-stack.sh`: **nenhum** `DEFAULT DEMO VALUE`; todos os containers `healthy`; banco ainda identificado pelo guard.
- Marcador de persistência ainda presente; novo backup + ensaio de restauração.
- Conta única criada (`create-admin-user.sh`), login ok, cadastro público recusado.

## 5. Reversão
Os valores antigos são os de demonstração do upstream (públicos). Reverter = restaurar as variáveis anteriores + `ALTER USER` de volta + Deploy; ou, como não há dados, restaurar o backup. Guardar uma cópia **fora do servidor** da lista de nomes/valores alterados (nunca dos segredos novos num lugar público).

## 6. Portões de autorização
| Portão | Libera | Escrita em produção |
|---|---|---|
| **G1** | Marcador de persistência + redeploy sem mudanças (+ backup) | 1 comentário no banco (revertido por `clear`) e um redeploy |
| **G2** | Janela de correção das credenciais (§3) | Papéis do banco, `_supavisor`, ambiente, deploy |
| **G3** | Aplicar as 7 migrations (`migrate.sh`), testes e integração | Esquema do banco |

Ordem: G1 → G2 → G3. Cada portão exige "sim" explícito do proprietário e a saída verde do portão anterior.

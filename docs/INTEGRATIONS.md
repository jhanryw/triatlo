# INTEGRATIONS — Amazfit Active 2, Apple Health, IA, Web Push

> Estado: Entrega 0 (pesquisa). **Nada foi implementado.** ✅ conferido em fonte oficial em 2026-10-31 · ⚠️ fonte não oficial/parcial · ❓ não conferido · ⛔ proibido pelo projeto.

## 1. Amazfit Active 2

### 1.1 O que foi verificado
| Afirmação | Estado | Fonte |
|---|---|---|
| O Active 2 roda **Zepp OS**; a documentação do desenvolvedor trata de *Mini Programs* e *watch faces* que executam **no relógio** (inclui sensores de FC, SpO2, calorias, estresse, sono como APIs *no dispositivo*) | ✅ | docs.zepp.com, developer.zepp.com, GitHub zepp-health |
| Nas páginas consultadas de docs/portal do desenvolvedor **não há** API em nuvem/REST documentada para ler dados de saúde/treino do usuário | ✅ (ausência nas páginas consultadas; não prova inexistência) | developer.zepp.com/os/home |
| O portal lista *Console* e *Cooperation*, mas o conteúdo não foi acessível — pode existir programa de parceiros | ❓ | developer.zepp.com |
| Páginas do produto Amazfit dizem que o app Zepp sincroniza com **Apple Health** (além de Strava, Google Fit etc.) | ✅ (fato genérico) | amazfit.com |
| **Quais categorias** o Zepp grava no Apple Health (FC, FC repouso, HRV, sono, treinos, passos) | ❓ **não confirmado** | — |
| Agregadores comerciais (Terra, Thryve) oferecem acesso a dados Amazfit via autorização do usuário; ZeppBridge (projeto comunitário) afirma usar a Zepp Open Platform como app parceiro | ⚠️ | sites dos terceiros |
| O app Zepp registra FC, HRV, FC de repouso, estágios do sono, recuperação (descrição da App Store) — isto é o que o app **mede**, não o que **exporta** | ⚠️ | App Store |

### 1.2 Conclusão
**Não existe, até onde esta pesquisa comprova, API pública, self-service e documentada para um app próprio ler dados do Amazfit.** Não presumir o contrário. Os caminhos plausíveis dependem de (a) a ponte pelo **Apple Health**, (b) exportação manual, ou (c) programa de parceiros/agregadores pagos de terceiros.

### 1.3 Caminhos avaliados

| ID | Caminho | Viabilidade | Custo | Privacidade/risco | Estado |
|---|---|---|---|---|---|
| **I-1** | **Importação manual estruturada** (formulário/CSV/JSON com treino, duração, FC média/máx, esforço percebido, sono) | Certa — não depende de terceiros | Nenhum | Dados ficam no sistema | **[PROPOSTA]** implementar primeiro (Entrega 3 → manual; Entrega 7 → importação em lote) |
| **I-2** | **Zepp → Apple Health → ponte nativa iOS → API do app.** PWA **não acessa HealthKit** (conhecido ❓; confirmar). Exige app nativo mínimo que leia HealthKit com permissão e envie ao backend | Depende de I-2a abaixo | Provável conta Apple Developer paga (US$ 99/ano ❓) para distribuição estável; sem ela, perfis de teste expiram em ~7 dias ❓ | Dados de saúde saem do iPhone para o backend próprio com autorização explícita | **[PENDENTE]** — **apresentar decisão antes de implementar** |
| **I-3** | **Atalhos do iOS (Shortcuts)**: automação que lê amostras do Apple Health e envia por HTTPS ao backend | Plausível ❓ (existe ação de ler amostras de Saúde); limites de tipos/volume/execução em segundo plano não verificados | Nenhum | Token de ingestão no Atalho; dados só ao backend próprio | **[HIPÓTESE]** — validar em spike |
| **I-4** | App de terceiros que exporta o Apple Health para API/arquivo (ex.: ferramentas de exportação) | ❓ | Possivelmente pago | Terceiro passa a tratar dados sensíveis | **[HIPÓTESE]**, só com aprovação explícita |
| **I-5** | Agregador comercial (Terra, Thryve) | ⚠️ existe | Pago | Terceiro processa e armazena dados de saúde | **Não adotar sem autorização** (serviço pago + privacidade) |
| **I-6** | Programa de parceiros da Zepp Open Platform | ❓ desconhecido | ❓ | Depende de contrato | **[PENDENTE]** — o usuário pode consultar a Zepp; não presumir |
| **I-7** | Scraping, engenharia reversa do app/API privados, uso de credenciais do Zepp em terceiros | — | — | Risco de bloqueio de conta e violação de termos | ⛔ **Proibido** |

### 1.4 Spike de validação (Entrega 7 — requer ação manual do usuário no iPhone)
1. No app Zepp, ativar o compartilhamento com Apple Health (se existir) e fazer 1 treino de teste + 1 noite de sono.
2. Em Saúde → Compartilhamento → Apps → Zepp, **listar quais categorias o Zepp está gravando** (FC, FC em repouso, HRV, sono, treinos, passos, VO₂ máx…).
3. Verificar, no próprio app Saúde, quais dessas categorias têm dados reais com a **fonte = Zepp**.
4. Com base nessa lista real, construir a tabela "métrica × disponível × latência × qualidade" abaixo e só então escolher I-2/I-3.
5. Verificar o que o Zepp permite exportar manualmente (dados da conta) ❓ para alimentar I-1.

### 1.5 Matriz de métricas (a preencher no spike — **não presumir**)
| Métrica | Medida pelo relógio | Chega ao Apple Health | Exportável manualmente | Observações |
|---|---|---|---|---|
| Treinos (tipo, duração, distância) | ❓ | ❓ | ❓ | |
| FC durante exercício | ❓ | ❓ | ❓ | |
| FC de repouso | ❓ | ❓ | ❓ | |
| HRV | ❓ | ❓ | ❓ | Definição/algoritmo do fabricante pode diferir; não comparar valores absolutos entre fontes |
| Sono (duração, horários, estágios) | ❓ | ❓ | ❓ | |
| Passos/atividade | ❓ | ❓ | ❓ | |
| Natação em piscina (voltas, SWOLF) | ❓ | ❓ | ❓ | Frequentemente limitado em pontes ❓ |

### 1.6 Abstração de fonte de dados **[PROPOSTA]** (Entrega 3/7)
Interface `DataSource` em `packages/shared`: cada fonte (manual, arquivo, ponte HealthKit, conector futuro) produz *registros normalizados* com `source`, `external_id` (idempotência), `recorded_at`, `received_at`, `quality`, `raw_ref` e campos opcionais — **campos ausentes permanecem nulos**. A camada de dados rejeita/identifica qualquer registro sem origem real; **proibido dado fictício em produção** (dados de exemplo só em `supabase/seed` e rotulados).

## 2. Apple Health / HealthKit
- PWA em Safari/Tela de Início **não tem acesso ao HealthKit** ❓ (restrição conhecida da plataforma; confirmar na documentação da Apple antes da decisão I-2).
- Qualquer ponte exigirá app nativo ou Atalhos; **documentar a arquitetura e pedir aprovação antes de implementar** (requisito do usuário).
- Esboço de arquitetura I-2 (apenas para decisão futura): app iOS mínimo (Swift) com permissão de leitura *somente* das categorias aprovadas → fila local → `POST /api/ingest/health` autenticado com token de dispositivo de escopo único → validação, deduplicação por `external_id`, gravação com `source='healthkit'`.

## 3. IA multimodal (Entregas 5–6)
- Provedor **configurável**, inicialmente OpenAI **[APROVADO]**; interface `AiProvider` em `packages/shared`; modelo e provedor em configuração, não no código.
- **Antes da primeira chamada**: tela em Configurações → IA listando exatamente quais dados são enviados (foto da refeição, texto, trechos do histórico), consentimento por finalidade, chave só no servidor, orçamento e limite de chamadas, registro de cada chamada (sem armazenar mais do que o necessário).
- Saídas de IA são **sugestões** com incerteza explícita; passam por validação de schema; nunca aplicam alterações de treino por conta própria (ver ARCHITECTURE §6).
- Atualizar IDs de modelo e preços somente na Entrega 5, a partir da documentação do provedor vigente. Nada de modelos/preços assumidos agora.

## 4. Web Push
Ver ARCHITECTURE §5. Documentação para o usuário (a incluir no app): no iPhone é preciso **iOS ≥ 16.4**, adicionar o app à Tela de Início, abrir pelo ícone e tocar em "Ativar notificações"; Modos de Foco e economia de energia podem atrasar ou silenciar avisos.

## 5. Supabase
**Instalação existente (decisão A-24):** Kong 3.9.1 + GoTrue v2.186.0 + PostgREST 14.8 no EasyPanel; sem outra instância. Contrato com o app:

| Aspecto | Valor |
|---|---|
| URL pública | `NEXT_PUBLIC_SUPABASE_URL` (ou `SUPABASE_URL`) = `https://qarvon-supabase-triatlo.uxxkgy.easypanel.host` |
| Chave pública | **anon JWT legado** em `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ou `SUPABASE_ANON_KEY`/`…PUBLISHABLE_KEY`); o Kong **não** aceita `sb_publishable_` |
| Chaves recusadas pelo app | demonstração pública (hash SHA-256), `service_role`, `sb_secret_` |
| Credencial privilegiada | `SERVICE_ROLE_KEY`: só scripts/worker no backend, nunca no `web` |
| Rotas usadas | `/auth/v1`, `/rest/v1`, `/storage/v1` (bucket privado `meal-photos`) |
| Diagnóstico | `/api/health` (booleanos) e `/api/health/supabase` (alcance, tipo de chave, problema) |

Sem integrações de terceiros além de SMTP (a definir, Q-05), provedor de IA (futuro) e destino de backup (Q-03). Procedimentos: [SUPABASE_EXISTING.md](SUPABASE_EXISTING.md).

## 6. Estado após a Entrega 1
Nenhuma integração foi implementada. Existem apenas contratos: `DataSource`/`NormalizedRecord` e `AiProvider`/`AiDisclosure` (`packages/shared`), a UI de Web Push inativa e o stub `POST /api/push/subscribe` (501). A tela Configurações → Integrações informa que o Amazfit "não está configurado" e que não há API pública comprovada.

## 7. Estado após a entrega integrada (2026-10-31)
- **Amazfit / Zepp (real, verificado só com arquivos de teste):** importação de **GPX/TCX** e do **export.xml do Apple Health** em Configurações → Relógio. O app lê o arquivo em *stream*, mostra o inventário por origem (o nome que o Zepp grava no app Saúde aparece ali), e só grava depois da confirmação. Sono, FC de repouso, HRV e treinos entram com procedência (`file_import`, hash do arquivo, `external_id`); reimportar não duplica. **Ainda não foi validado com um export real do seu relógio** — isso depende do seu arquivo. Pelo iPhone: Zepp → Saúde (Apple) → app Saúde → exportar → descompactar `export.zip` no app Arquivos → escolher `export.xml`.
- **IA de refeições:** implementada (`packages/data/src/ai.ts`), desligada até haver `OPENAI_API_KEY` + `AI_MODEL` no serviço `web` **e** consentimento do usuário. Nunca testada contra um provedor real (testes usam provedor simulado).
- **Web Push:** `POST /api/push/subscribe` grava a inscrição e o consentimento (RLS); o worker envia com VAPID. Falta gerar chaves VAPID, configurá-las e testar num iPhone (iOS ≥ 16.4, app na Tela de Início).

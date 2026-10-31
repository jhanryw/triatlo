# ROADMAP — Marcos e critérios de aceitação

> Estado: Entrega 0 concluída (documentação + esqueleto). As Entregas 1–8 são o plano **[PROPOSTA]** de execução, a ser aprovado. Cada entrega termina com o relatório de 7 itens (implementado, arquivos, testes, o que não funciona, decisões pendentes, como executar/validar, ações manuais).

## Visão sequencial

```
E0 Auditoria ✔ → E1 Fundação → E2 Persistência/Segurança → E3 Núcleo pessoal
   → E4 Notificações → E5 Alimentação → E6 Motor adaptativo → E7 Integração Amazfit → E8 Validação integrada
```

Dependências principais: E2 exige E1 (infra de pé); E4 exige E2 (tabelas, RLS, Auth) e E3 (sessões para agendar); E6 exige regras quantitativas aprovadas (Q-06) e dados de E3/E5; E7 exige spike (H-01/H-02) e decisão sobre app nativo (Q-09).

## E0 — Auditoria técnica e preparação ✔ (2026-10-31)
Entregou: auditoria do diretório (vazio), pesquisa em fontes oficiais, riscos, dependências, esqueleto de pastas, documentos, estratégia de testes/RLS/backup. **Sem código de aplicação.**
Pendente para sair: aprovação do plano e resposta às pendências Q-01…Q-04 (mínimo para E1).

## E1 — Fundação executável
**Escopo**: Next.js+TS+Tailwind em `apps/web`; workspaces; `packages/shared|domain` vazios mas compilando; `apps/worker` com *hello-job* sem lógica de negócio; `.env.example`; Dockerfiles de produção (web e worker); manifest PWA + ícones + shell responsivo com as 6 abas (placeholders); cliente Supabase preparado (sem uso de dados); Vitest, ESLint, `tsc`, build; GitHub Actions; documentação de deploy; **spike** do Supabase no EasyPanel (P-05/H-03/H-04).
**Aceite**: `lint`, `typecheck`, `test`, `build` verdes localmente e no CI; imagens Docker constroem e sobem; `/api/health` responde em produção sob HTTPS; app instala na Tela de Início do iPhone; nenhum segredo no repositório; Supabase acessível (se a infra estiver pronta) e Studio protegido.
**Fora**: autenticação, tabelas, funcionalidades.

**Status (2026-10-31): implementada localmente; pendente validação no CI e no servidor.** Feito: monorepo npm workspaces; `shared`/`domain` com contratos de plano versionado, proposta, aprovação, justificativa e auditoria (sem critérios esportivos); app Next.js 16 com 6 seções, estados vazios e conteúdo de demonstração identificado; manifest, ícones e service worker; arquitetura de Web Push **inativa**; cliente Supabase sem servidor; worker esqueleto com `/healthz`; Dockerfiles; GitHub Actions; `scripts/security-check.mjs`; 61 testes. **Não validado**: build Docker e workflow (sem Docker local nem remoto GitHub), registro real do service worker e instalação no iPhone, deploy no EasyPanel, Supabase. Ver `docs/DEPLOYMENT.md` e `DECISIONS.md` (A-15…A-22, P-17…P-22, Q-14…Q-16).

## E2 — Persistência e segurança
**Escopo**: Auth (cadastro público desligado), migrações versionadas, tabelas essenciais (perfil, disponibilidade, sessões, check-ins, auditoria, jobs, assinaturas push — o que for necessário), RLS em tudo, Storage privado, papéis (web/worker), backup + restauração testada, exportação/exclusão básicas.
**Aceite**: suíte de RLS completa (QUALITY_SECURITY §3) passa; CI falha para tabela sem RLS; login/logout/rota protegida testados; restauração de backup validada num ambiente descartável; DATABASE_SCHEMA.md criado.

## E3 — Funcionalidades pessoais básicas
**Escopo**: perfil e fuso, disponibilidade semanal (trabalho 9–17, deslocamento, alimentação, sono), calendário, check-in diário rápido e opcional, registro manual de treinos (planejado/realizado/parcial/substituído/reagendado/cancelado), histórico.
**Aceite**: fluxo completo manual utilizável no iPhone; treino não realizado não penaliza nem acumula; nenhum plano exigente gerado automaticamente; testes de fuso/DST.
**Sem**: recomendação automática de treino.

## E4 — Notificações
**Escopo**: assinatura Web Push com consentimento, worker com fila persistente, cronograma automático (treino, refeição, check-ins), supersessão ao reagendar, limites e silêncio, status de entrega, inbox in-app, observabilidade dos jobs.
**Aceite**: push real recebido em iPhone com PWA instalada; sem duplicidade em teste de concorrência; reinício do worker não perde nem duplica jobs; reagendar cancela avisos antigos; 404/410 desativa assinatura; limites de frequência respeitados (valores aprovados em Q-11).

## E5 — Alimentação
**Escopo**: plano alimentar flexível, opções de refeição/lanche, registro com foto (Storage privado), análise multimodal **após** tela de consentimento/dados enviados, correção manual, histórico, planejamento ao redor do treino, lista de preparo/compras.
**Aceite**: estimativas sempre rotuladas como incertas; ausência de registro ≠ ausência de refeição; nenhuma recomendação de restrição calórica baseada em um dia; teto de custo de IA funcionando; sem diagnóstico/prescrição clínica.

## E6 — Motor de adaptação
**Pré-requisitos**: BUSINESS_RULES.md escrito e **aprovado** (limites, janelas, histerese, regra de conflito subjetivo×relógio, dados insuficientes).
**Escopo**: pipeline determinística, propostas tipadas, aprovação, versionamento, auditoria, desfazer, gatilhos diário e por evento; IA contextual somente depois de validar as regras.
**Aceite**: cenários de teste de §E8 passam no nível unitário; nenhuma alteração fora de `domain` + validação backend; sem alterações repetitivas/contraditórias; progressões nunca automáticas sem aprovação.

## E7 — Integração esportiva
**Pré-requisitos**: spike concluído; decisão I-1…I-6 aprovada (Q-08/Q-09); se houver app nativo, arquitetura aprovada antes.
**Escopo**: conector aprovado + importação manual em lote como alternativa; matriz de métricas real.
**Aceite**: dados importados identificam a origem; falha de sincronização é visível e não corrompe dados; nada simulado em produção.

## E8 — Validação integrada
Cenários: boa recuperação; fadiga; alimentação insuficiente; mudança de horário; dados ausentes; dados conflitantes (relato × relógio); falha de sincronização; falha do push; reinício do worker; restauração de backup. Resultado: relatório de validação e lista de pendências.

---

## Checklist objetivo — validação da primeira implantação (fim da E1)

**Repositório e qualidade**
- [ ] Repositório privado no GitHub; branch `main` protegida; `.gitignore` bloqueia `.env*`
- [x] `npm ci` com lockfile funciona do zero (verificado localmente em 2026-10-31)
- [x] `lint`, `typecheck`, `test`, `build` verdes **localmente**; [ ] verdes no CI (workflow nunca executado)
- [x] Varredura de segredos local sem achados (`npm run security:check`); [ ] gitleaks no CI

**Build e deploy**
- [ ] Imagens `web` e `worker` constroem (multi-stage, usuário não-root, Node fixado) — escritas, **não executadas** (sem Docker local); layout `standalone` validado rodando `node apps/web/server.js` localmente
- [ ] EasyPanel: dois serviços App ligados ao GitHub, auto deploy por push funcionando
- [ ] Variáveis (incl. `NEXT_PUBLIC_*` como variáveis de build) configuradas só no EasyPanel
- [ ] `GET https://app.<domínio>/api/health` → 200 sob HTTPS válido
- [ ] Worker inicia, registra heartbeat e sobrevive a reinício

**Supabase**
- [ ] Rota R1/R2 decidida e documentada; versões das imagens fixadas
- [ ] Todos os segredos padrão trocados; `.env` guardado em cofre fora do servidor
- [ ] API acessível por HTTPS; Studio com Basic Auth/túnel; Postgres **não** exposto
- [ ] Cadastro público desativado
- [ ] Um backup manual realizado **e restaurado** num ambiente descartável

**PWA**
- [ ] Manifest válido; ícones; instalável na Tela de Início do iPhone e no desktop
- [ ] Service Worker registrado servido sem cache
- [ ] Nenhum pedido de permissão de notificação ocorre sem ação do usuário

**Documentação**
- [ ] Deploy GitHub → EasyPanel documentado passo a passo
- [ ] DECISIONS atualizado (propostas aprovadas movidas; pendências restantes listadas)
- [ ] Relatório de entrega com os 7 itens

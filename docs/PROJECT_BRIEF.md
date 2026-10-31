# PROJECT_BRIEF — Triatlo Inteligente

> Status do documento: Entrega 0 (auditoria e preparação). Última atualização: 2026-10-31.
> Legenda de estado usada em todos os documentos: **[APROVADO]** decidido pelo usuário · **[PROPOSTA]** sugestão técnica aguardando aprovação · **[HIPÓTESE]** premissa a validar · **[PENDENTE]** decisão ou informação ainda inexistente.

## 1. O que é

Aplicativo pessoal, de uso exclusivo de uma pessoa, para retomar o triatlo olímpico de forma sustentável após ~5 meses sem treinar. Combina planejamento de treino, alimentação, sono/recuperação e um motor adaptativo que propõe (e, dentro de limites aprovados, aplica) ajustes no calendário. **[APROVADO]**

Não é produto comercial: sem multiempresa, sem monetização, sem recursos sociais. **[APROVADO]**

## 2. Contexto do usuário (premissas de produto) **[APROVADO]**

- Experiência prévia em natação, ciclismo, corrida e musculação (>12 h/semana no passado). **O volume histórico não deve ser usado para gerar um plano exigente.**
- Histórico de fadiga persistente, queda de rendimento, irritabilidade, ansiedade, sono insuficiente, alimentação inadequada e desmotivação.
- Trabalha das 9h às 17h; precisa de margem para deslocamento e alimentação; dorme ~8 h.
- Pretende treinos mais leves em dias úteis e janelas maiores nos fins de semana.
- Objetivo inicial: triatlo olímpico, **sem data de prova definida**.
- Modalidades: natação em piscina, ciclismo indoor, corrida, musculação complementar, recuperação/descanso.
- Único dispositivo esportivo: **Amazfit Active 2**. Sem Strava, Garmin, Polar ou COROS.

## 3. Princípios inegociáveis

1. **Sustentabilidade antes de desempenho.** Recuperação, disponibilidade e alimentação limitam a progressão.
2. **Nenhum LLM decide sozinho.** Separação em quatro camadas: cálculo determinístico → regras de segurança → análise de tendências → interpretação generativa. Toda alteração de treino passa por validação explícita no backend.
3. **Incerteza explícita.** Ingestão e gasto energético são estimativas; ausência de registro ≠ ausência de refeição; dados ausentes não geram conclusões nem progressões.
4. **Sem diagnóstico.** Nada de diagnosticar REDs ou condições clínicas, prescrever dietas clínicas ou suplementação individualizada. Não substitui avaliação médica ou nutricional.
5. **Sem culpa.** Sem gamificação punitiva, sequências obrigatórias, mensagens de culpa ou metas de restrição alimentar. Treino não realizado não é penalizado nem acumulado.
6. **Autonomia híbrida.** Ajustes seguros (reorganização de horários, reduções dentro de limites aprovados) podem ser automáticos; aumentos de carga/intensidade e mudanças estruturais exigem aprovação; tudo é versionado, justificado, auditado e reversível.
7. **Privacidade por padrão.** Dados de saúde são sensíveis: RLS, armazenamento privado, segredos só no servidor, minimização de dados enviados à IA e consentimento informado.
8. **Nada inventado.** Sem APIs, métricas, capacidades do relógio, fórmulas fisiológicas ou limites quantitativos que não estejam documentados e aprovados. Sem dados simulados em produção.

## 4. Escopo por módulo (visão de alto nível)

| Módulo | Resumo | Entrega |
|---|---|---|
| Fundação | Monorepo, Docker, PWA, layout, CI | 1 |
| Persistência e segurança | Auth, migrações, RLS, Storage privado | 2 |
| Núcleo pessoal | Perfil, disponibilidade, calendário, check-in, treinos manuais, histórico | 3 |
| Notificações | Web Push, fila, worker, cronograma automático | 4 |
| Alimentação | Plano flexível, registro com foto, correção manual, análise multimodal | 5 |
| Motor de adaptação | Regras determinísticas, versionamento, aprovações; IA contextual só depois de regras validadas | 6 |
| Integração esportiva | Conector Amazfit viável + importação manual | 7 |
| Validação integrada | Cenários de recuperação, fadiga, falta de dados, conflitos, falhas | 8 |

Detalhamento, critérios de entrada/saída e dependências: [ROADMAP.md](ROADMAP.md).

## 5. Navegação do app (alvo) **[APROVADO como proposta inicial do usuário]**

Hoje · Treinos · Alimentação · Evolução · Assistente · Configurações. Mobile-first (iPhone prioritário), com suporte a desktop. Funcional antes de decorativo.

## 6. Fora de escopo (por decisão do usuário)

Monetização; multiusuário/multiempresa; integrações com Strava, Garmin, Polar, COROS; gamificação punitiva; scraping ou engenharia reversa de protocolos privados.

## 7. Estado atual

- **Entrega 0** (2026-10-31): auditoria, documentação, arquitetura. **Entrega 1** (2026-10-31, local): fundação executável — monorepo, app Next.js com navegação e estados vazios, PWA preparada, worker esqueleto, Dockerfiles e CI escritos, contratos do modelo de planos versionados (ver [DOMAIN_MODEL.md](DOMAIN_MODEL.md)).
- Nenhuma infraestrutura foi instalada: servidor/EasyPanel, domínio, Supabase e repositório remoto são **[PENDENTE]** (ver [DECISIONS.md](DECISIONS.md)). Não há autenticação, banco, treinos, notificações reais, IA nem integração Amazfit.

## 8. Mapa dos documentos

| Documento | Conteúdo |
|---|---|
| [PROJECT_BRIEF.md](PROJECT_BRIEF.md) | Este documento |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitetura, componentes, fluxos, riscos, dependências |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Supabase self-hosted no EasyPanel, Docker, deploy, segredos |
| [QUALITY_SECURITY.md](QUALITY_SECURITY.md) | Testes, autenticação, RLS, backup e recuperação |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Amazfit/Zepp/Apple Health, IA multimodal, Web Push |
| [DECISIONS.md](DECISIONS.md) | Decisões aprovadas, propostas, hipóteses e pendências |
| [ROADMAP.md](ROADMAP.md) | Marcos, critérios de aceitação e checklist da primeira implantação |
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md) | Modelo conceitual: planos versionados, propostas, aprovações, auditoria |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deploy GitHub → CI → EasyPanel (documentado, não executado) |
| [../CLAUDE.md](../CLAUDE.md) | Regras para o desenvolvimento assistido por IA |

Documentos previstos para entregas futuras (não criados agora): `PRD.md`, `DATABASE_SCHEMA.md`, `BUSINESS_RULES.md`, `DESIGN_SYSTEM.md`.

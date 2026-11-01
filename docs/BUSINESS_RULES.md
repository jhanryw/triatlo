# BUSINESS_RULES — regras do assistente (estado: rascunho v1, inativo até o usuário aprovar)

Estas regras são **escolhas de política do projeto**, não fatos médicos nem fisiológicos. Nada aqui é diagnóstico. Os números vivem em `training_rule_sets` (versionados, imutáveis) e só valem depois que **você** aprova a versão em Configurações → Regras do assistente.

## O que o motor pode e não pode fazer
- **Pode** propor **reduções** da duração de sessões planejadas nas próximas `horizonHours` (48 h).
- **Não pode** aumentar carga, criar sessões, trocar modalidade ou mexer em sessões já feitas/canceladas. Progressão de carga é sempre decisão sua.
- Toda proposta traz: resumo, regras aplicadas (`reduce-on-sustained-worsening@rules-vN`), dados usados, qualidade dos dados, ressalvas, e é reversível (desfazer cria nova versão).

## Quando propõe
1. Existem ao menos `minKnownDays` (5) dias com dado real nos últimos `lookbackDays` (14). Senão: "dados insuficientes", nada é proposto.
2. Cada medida é comparada com a **mediana dos seus próprios dias anteriores** (nunca com um limite absoluto): fadiga acima, ou disposição/humor/recuperação percebida/qualidade do sono abaixo, por pelo menos `minPointsWorse` (1) ponto; ou sono ≥ `shortfallFraction` (20%) abaixo do seu normal.
3. A piora precisa durar `consecutiveDays` (2) dias seguidos **com dado**. Dia sem dado quebra a sequência (ausência não é "bom" nem "ruim").
4. Dado contraditório (ex.: relógio bom, você relata cansaço): o relato é mantido, a qualidade vira `conflicting` e a proposta carrega a ressalva.
5. Estabilidade: no máximo `maxProposalsPerWeek` (3) por semana; mínimo de 24 h entre mudanças na mesma sessão; sessão com proposta aberta não recebe outra.

## Quanto reduz
`reduction.durationFraction` (20%) da duração planejada, nunca mais de 50%.

## Autonomia
- Padrão: **toda** mudança pede sua aprovação (Hoje → Aprovar/Recusar).
- Opcional (você liga ao aprovar as regras): reduções de até `maxAutoFraction` (20%) são aplicadas sozinhas, com registro e botão de desfazer. Qualquer outra coisa continua pedindo aprovação.

## Dados e honestidade
- Prioridade às fontes automáticas (relógio via arquivo importado); entrada manual quando agrega informação.
- Ausente ≠ zero. Estimativas de alimentação são estimativas (com confiança) e nunca são somadas parcialmente.
- Check-in 1–5 (P-29) não tem significado clínico.

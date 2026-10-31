import type { DataQuality, Modality, SessionStatus } from "@triatlo/shared";

/** pt-BR labels for the shared vocabularies. Technical ids stay in English. */
export const MODALITY_LABELS: Record<Modality, string> = {
  swim: "Natação em piscina",
  bike_indoor: "Ciclismo indoor",
  run: "Corrida",
  strength: "Musculação complementar",
  recovery: "Recuperação",
  rest: "Descanso",
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, { label: string; description: string }> = {
  planned: { label: "Planejado", description: "Sessão prevista no calendário." },
  completed: { label: "Realizado", description: "Sessão concluída conforme o previsto." },
  partial: { label: "Parcialmente realizado", description: "Parte da sessão foi feita." },
  replaced: { label: "Substituído", description: "Trocado por outra atividade." },
  rescheduled: { label: "Reagendado", description: "Movido para outro horário." },
  cancelled: { label: "Cancelado", description: "Não será feito. Sem penalidade." },
};

export const DATA_QUALITY_LABELS: Record<DataQuality, string> = {
  complete: "Dados completos",
  partial: "Dados parciais",
  missing: "Sem dados",
  conflicting: "Dados conflitantes",
};

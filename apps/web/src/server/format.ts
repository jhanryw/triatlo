import { utcToLocalDate } from "@triatlo/domain";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "seg 02/11 · 06:30" in the person's time zone. */
export function formatLocal(iso: string, timeZone: string): string {
  const date = utcToLocalDate(iso, timeZone);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${time}`;
}

export const minutesLabel = (m: number | null): string => (m === null ? "—" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
export const orDash = (v: number | null, suffix = ""): string => (v === null ? "—" : `${v}${suffix}`);

/** ISO instant `days` days before now. */
export const daysAgoIso = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

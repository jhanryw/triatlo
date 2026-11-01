/** Small helpers to read HTML form fields. Empty means UNKNOWN (null), never 0. */
export const str = (f: FormData, k: string): string | null => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
export const num = (f: FormData, k: string): number | null => {
  const v = str(f, k);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
export const int = (f: FormData, k: string): number | null => {
  const n = num(f, k);
  return n === null ? null : Math.round(n);
};

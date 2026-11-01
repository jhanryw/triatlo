/**
 * Nutrition totals for a meal from its items. All values are ESTIMATES. A nutrient total is only produced when EVERY
 * item has that nutrient estimated; otherwise it is null (unknown) — a partial sum would look like a measurement.
 */
export interface ItemEstimate {
  energyKcal: number | null;
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
}
export interface MealTotals extends ItemEstimate {
  itemCount: number;
  /** Nutrients that are NOT in the totals because at least one item lacked them. */
  incomplete: Array<keyof ItemEstimate>;
}

export function mealTotals(items: readonly ItemEstimate[]): MealTotals {
  const keys: Array<keyof ItemEstimate> = ["energyKcal", "proteinG", "carbohydrateG", "fatG"];
  const totals: ItemEstimate = { energyKcal: null, proteinG: null, carbohydrateG: null, fatG: null };
  const incomplete: Array<keyof ItemEstimate> = [];
  for (const k of keys) {
    if (items.length > 0 && items.every((i) => i[k] !== null)) totals[k] = Math.round(items.reduce((s, i) => s + (i[k] as number), 0) * 10) / 10;
    else incomplete.push(k);
  }
  return { ...totals, itemCount: items.length, incomplete };
}

/** User correction of a quantity scales the item's estimated values proportionally (the user can still overwrite them). */
export function scaleItem(item: ItemEstimate, factor: number): ItemEstimate {
  if (!(factor >= 0) || !Number.isFinite(factor)) throw new Error("invalid scale factor");
  const s = (v: number | null) => (v === null ? null : Math.round(v * factor * 10) / 10);
  return { energyKcal: s(item.energyKcal), proteinG: s(item.proteinG), carbohydrateG: s(item.carbohydrateG), fatG: s(item.fatG) };
}

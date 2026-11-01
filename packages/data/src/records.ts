import type { CompletedWorkoutInput, DailyCheckinInput, MealInput, MealItemInput, NutritionEstimateInput } from "@triatlo/shared";
import { type DailyContextRow, dayContextFromRow } from "@triatlo/domain";
import { type Ctx, must, mustOk } from "./core";

/** One check-in per local day: saving again the same day updates it (the user can complete it later). */
export async function saveCheckin(ctx: Ctx, input: DailyCheckinInput): Promise<void> {
  mustOk(await ctx.db.from("daily_checkins").upsert({
    user_id: ctx.userId, checkin_date: input.checkinDate, sleep_quality_score: input.sleepQualityScore, fatigue_score: input.fatigueScore,
    energy_score: input.energyScore, mood_score: input.moodScore, recovery_score: input.recoveryScore, notes: input.notes, source: "manual",
  }, { onConflict: "user_id,checkin_date" }), "save check-in");
}

export async function loadDayContexts(ctx: Ctx, fromDate: string, toDate: string) {
  const res = await ctx.db.from("v_daily_context").select("*").eq("user_id", ctx.userId).gte("day", fromDate).lte("day", toDate).order("day", { ascending: true });
  return (must(res, "load daily context") as DailyContextRow[]).map(dayContextFromRow);
}

export async function logWorkout(ctx: Ctx, w: CompletedWorkoutInput): Promise<string> {
  const res = await ctx.db.from("completed_workouts").insert({
    user_id: ctx.userId, planned_session_id: w.plannedSessionId, modality: w.modality, completion: w.completion, started_at: w.startedAt,
    duration_minutes: w.durationMinutes, distance_meters: w.distanceMeters, avg_heart_rate_bpm: w.avgHeartRateBpm, max_heart_rate_bpm: w.maxHeartRateBpm,
    perceived_exertion_scale: w.perceivedExertionScale, perceived_exertion_value: w.perceivedExertionValue, notes: w.notes, source: w.source,
    external_id: w.externalId, quality: w.quality,
  }).select("id").single();
  return (must(res, "log workout") as { id: string }).id;
}

export async function listWorkouts(ctx: Ctx, limit = 30) {
  return must(await ctx.db.from("completed_workouts").select("*").eq("user_id", ctx.userId).order("started_at", { ascending: false }).limit(limit), "list workouts");
}

export async function createMeal(ctx: Ctx, meal: MealInput): Promise<string> {
  const res = await ctx.db.from("meals").insert({ user_id: ctx.userId, eaten_at: meal.eatenAt, meal_type: meal.mealType, notes: meal.notes, photo_path: meal.photoPath }).select("id").single();
  return (must(res, "create meal") as { id: string }).id;
}

/** Stores the reviewed meal: items (flagged as user-corrected when changed), per-item estimates and ONE meal-level estimate. */
export async function saveReviewedMeal(
  ctx: Ctx, mealId: string,
  items: ReadonlyArray<{ item: MealItemInput; estimate: Omit<NutritionEstimateInput, "method" | "model" | "confidence" | "notes"> }>,
  mealEstimate: NutritionEstimateInput | null,
): Promise<void> {
  mustOk(await ctx.db.from("nutrition_estimates").delete().eq("meal_id", mealId), "clear estimates");
  mustOk(await ctx.db.from("meal_items").delete().eq("meal_id", mealId), "clear items");
  for (const { item, estimate } of items) {
    const created = await ctx.db.from("meal_items").insert({
      user_id: ctx.userId, meal_id: mealId, name: item.name, quantity: item.quantity, unit: item.unit, quantity_origin: item.quantityOrigin, user_corrected: item.userCorrected,
    }).select("id").single();
    const itemId = (must(created, "create meal item") as { id: string }).id;
    const any = [estimate.energyKcal, estimate.proteinG, estimate.carbohydrateG, estimate.fatG].some((v) => v !== null);
    if (any) {
      mustOk(await ctx.db.from("nutrition_estimates").insert({
        user_id: ctx.userId, meal_id: mealId, meal_item_id: itemId, energy_kcal: estimate.energyKcal, protein_g: estimate.proteinG,
        carbohydrate_g: estimate.carbohydrateG, fat_g: estimate.fatG, method: item.userCorrected ? "manual" : "ai",
      }), "create item estimate");
    }
  }
  if (mealEstimate) {
    mustOk(await ctx.db.from("nutrition_estimates").insert({
      user_id: ctx.userId, meal_id: mealId, meal_item_id: null, energy_kcal: mealEstimate.energyKcal, protein_g: mealEstimate.proteinG,
      carbohydrate_g: mealEstimate.carbohydrateG, fat_g: mealEstimate.fatG, method: mealEstimate.method, model: mealEstimate.model,
      confidence: mealEstimate.confidence, notes: mealEstimate.notes,
    }), "create meal estimate");
  }
}

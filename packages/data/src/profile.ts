import { type Profile, ProfileSchema, type AvailabilityWindowInput } from "@triatlo/shared";
import { type Ctx, maybe, must, mustOk } from "./core";

export async function getProfile(ctx: Ctx): Promise<Profile | null> {
  const res = await ctx.db.from("profiles").select("*").eq("user_id", ctx.userId).maybeSingle();
  const r = maybe(res, "load profile") as { display_name: string | null; timezone: string | null; locale: string } | null;
  return r === null ? null : ProfileSchema.parse({ displayName: r.display_name, timezone: r.timezone, locale: r.locale });
}

export async function saveProfile(ctx: Ctx, input: Profile): Promise<void> {
  const p = ProfileSchema.parse(input);
  mustOk(await ctx.db.from("profiles").upsert({ user_id: ctx.userId, display_name: p.displayName, timezone: p.timezone, locale: p.locale }, { onConflict: "user_id" }), "save profile");
}

export async function listAvailability(ctx: Ctx): Promise<Array<AvailabilityWindowInput & { id: string }>> {
  const res = await ctx.db.from("availability_windows").select("*").eq("user_id", ctx.userId).order("weekday").order("starts_at");
  return (must(res, "load availability") as Array<{ id: string; weekday: number; starts_at: string; ends_at: string; kind: AvailabilityWindowInput["kind"]; label: string | null }>)
    .map((r) => ({ id: r.id, weekday: r.weekday, startsAt: r.starts_at.slice(0, 5), endsAt: r.ends_at.slice(0, 5), kind: r.kind, label: r.label }));
}

export async function replaceAvailability(ctx: Ctx, windows: readonly AvailabilityWindowInput[]): Promise<void> {
  mustOk(await ctx.db.from("availability_windows").delete().eq("user_id", ctx.userId), "clear availability");
  if (windows.length > 0) {
    mustOk(await ctx.db.from("availability_windows").insert(windows.map((w) => ({ user_id: ctx.userId, weekday: w.weekday, starts_at: w.startsAt, ends_at: w.endsAt, kind: w.kind, label: w.label }))), "save availability");
  }
}

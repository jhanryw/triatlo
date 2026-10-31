import { z } from "zod";
import { UtcDateTimeSchema } from "./common";

/** Kinds of app-generated notifications (spec §9). Scheduling rules are defined in Delivery 4. */
export const NOTIFICATION_KINDS = [
  "workout_reminder",
  "meal_reminder",
  "morning_checkin",
  "post_workout_checkin",
  "meal_prep",
  "hydration_context",
  "plan_change",
  "approval_request",
  "recovery_alert",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Payload carried by a push message. Deliberately minimal: no health data in the payload.
 * public/sw.js parses the same shape defensively.
 */
export const PushPayloadSchema = z
  .object({
    kind: z.enum(NOTIFICATION_KINDS),
    title: z.string().min(1).max(80),
    body: z.string().min(1).max(200),
    /** Same-origin path to open on click. */
    url: z.string().startsWith("/").default("/"),
    /** Collapses/replaces earlier notifications with the same tag. */
    tag: z.string().min(1).optional(),
  })
  .strict();
export type PushPayload = z.infer<typeof PushPayloadSchema>;

/** Subscription as serialized by PushSubscription.toJSON(). */
export const PushSubscriptionInputSchema = z
  .object({
    endpoint: z.url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }).strict(),
  })
  .strict();
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

/** Consent evidence stored when the user explicitly enables push. */
export const PushConsentRecordSchema = z
  .object({
    grantedAt: UtcDateTimeSchema,
    userAgent: z.string().min(1),
    /** Version of the explanatory text shown before the permission prompt. */
    consentTextVersion: z.string().min(1),
    displayMode: z.enum(["standalone", "browser"]),
  })
  .strict();
export type PushConsentRecord = z.infer<typeof PushConsentRecordSchema>;

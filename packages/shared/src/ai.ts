import { z } from "zod";

/** What a given AI call is allowed to send. Must be shown to the user before any call is enabled. */
export const AiDisclosureSchema = z
  .object({
    purpose: z.string().min(1),
    dataCategories: z.array(z.string().min(1)).min(1),
    consentGrantedAt: z.string().min(1).nullable(),
  })
  .strict();
export type AiDisclosure = z.infer<typeof AiDisclosureSchema>;

export interface AiRequest {
  purpose: string;
  disclosure: AiDisclosure;
  /** Provider-agnostic prompt content. */
  input: string;
  imageRefs?: readonly string[];
}

export interface AiResponse {
  text: string;
  provider: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

/**
 * Provider abstraction (OpenAI first, replaceable). Output is untrusted: callers must validate it against a schema
 * and AI output must never apply plan changes by itself. No provider is implemented in Delivery 1.
 */
export interface AiProvider {
  readonly id: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

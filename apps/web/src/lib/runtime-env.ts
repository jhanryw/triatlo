/**
 * Runtime environment access for SERVER code.
 *
 * Why: `process.env.NEXT_PUBLIC_*` written literally is replaced at BUILD time by Next.js. When the hosting platform
 * does not forward service variables as Docker build args (EasyPanel did not), the bundle is built with empty values and
 * changing the variable later has no effect. Reading through a variable key defeats the build-time replacement, so the
 * value comes from the real environment of the running container and a restart is enough to change it.
 *
 * Only PUBLIC configuration may be read through here (URLs, publishable key, feature flags). Never privileged keys.
 */
export function runtimeEnv(key: string): string | undefined {
  const env: Record<string, string | undefined> = process.env;
  const value = env[key];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/** First non-empty value among the given variable names (e.g. NEXT_PUBLIC_X, then X). */
export function firstRuntimeEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = runtimeEnv(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

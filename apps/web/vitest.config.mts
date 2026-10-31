import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component tests render to static markup (no DOM needed), so only the JSX transform is required.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}", "public/**/*.test.ts"] },
});

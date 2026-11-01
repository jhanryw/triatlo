import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera is reserved for meal photos (Delivery 5); everything else stays off.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  // Only effective over HTTPS (EasyPanel's proxy terminates TLS).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle for the production Docker image.
  output: "standalone",
  // Monorepo: trace dependencies from the repository root (npm runs this from apps/web).
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@triatlo/shared", "@triatlo/domain", "@triatlo/data", "@triatlo/ingest"],
  // Meal photos from the phone camera go through Server Actions.
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must never be served from cache so updates roll out.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;

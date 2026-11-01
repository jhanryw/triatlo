// Repository security guard (runs locally and in CI). Dependency-free.
//
// 1. No secret-bearing files (.env*, keys, dumps) among files that git would track.
// 2. No secret-looking values in text files.
// 3. The web app source never references privileged credentials.
// 4. Built browser bundles (.next/static) never contain privileged credential names.
//
// Usage: node scripts/security-check.mjs   (SECURITY_CHECK_ROOT overrides the repo root, used by tests)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.SECURITY_CHECK_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", ".git"]);
const MAX_BYTES = 1_000_000;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|gz|map)$/i;

const FORBIDDEN_FILE = [
  { re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/, why: "environment file" },
  { re: /\.(pem|key|p12|pfx)$/i, why: "key material" },
  { re: /\.(dump|sql\.gz)$/i, why: "database dump" },
];

const SECRET_VALUE = [
  { re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, why: "private key block" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, why: "JWT (e.g. Supabase legacy keys)" },
  { re: /\bsb_secret_[A-Za-z0-9_-]{16,}/, why: "Supabase secret key" },
  { re: /\bsk-[A-Za-z0-9_-]{24,}/, why: "AI provider API key" },
  { re: /VAPID_PRIVATE_KEY\s*=\s*[A-Za-z0-9_-]{20,}/, why: "VAPID private key value" },
  { re: /(?:POSTGRES_PASSWORD|DASHBOARD_PASSWORD)[ \t]*=[ \t]*(?!your-|change|<|\$|[ \t]*$)\S{8,}/m, why: "database/dashboard password value" },
];

// Vendored, unmodified upstream material (see infra/supabase/UPSTREAM.md): shell templates mention variable
// names next to shell expressions, which the value patterns cannot tell apart from real values.
const SKIP_VALUE_SCAN = /^infra\/supabase\/(utils|upstream)\//;

// These files only NAME privileged credentials in order to REFUSE them (classifyKey). Server-side, never bundled for
// the browser: the .next/static scan below still fails if a privileged name ever reaches a client chunk.
const ALLOWED_PRIVILEGED_MENTIONS = new Set([
  "apps/web/src/lib/supabase/env.ts",
  "apps/web/src/lib/env.test.ts",
  "apps/web/src/app/api/health/supabase/route.test.ts",
]);

const PRIVILEGED_NAMES = /SUPABASE_SECRET_KEY|SERVICE_ROLE|service_role|VAPID_PRIVATE_KEY|sb_secret_/;

function listFiles() {
  if (existsSync(join(root, ".git"))) {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
    });
    return out.split("\0").filter(Boolean);
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(relative(root, full));
    }
  };
  walk(root);
  return files;
}

function listAll(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listAll(full));
    else files.push(full);
  }
  return files;
}

const problems = [];
const files = listFiles().filter((file) => existsSync(join(root, file)));

for (const file of files) {
  for (const rule of FORBIDDEN_FILE) {
    if (rule.re.test(file)) problems.push(`${file}: ${rule.why} must not be versioned`);
  }
}

for (const file of files) {
  if (BINARY_EXT.test(file) || file.endsWith("package-lock.json")) continue;
  const full = join(root, file);
  if (statSync(full).size > MAX_BYTES) continue;
  const text = readFileSync(full, "utf8");
  if (!SKIP_VALUE_SCAN.test(file)) {
    for (const rule of SECRET_VALUE) {
      if (rule.re.test(text)) problems.push(`${file}: looks like a ${rule.why}`);
    }
  }
  if (/^apps\/web\/src\//.test(file) && !ALLOWED_PRIVILEGED_MENTIONS.has(file) && PRIVILEGED_NAMES.test(text)) {
    problems.push(`${file}: the web app must never reference privileged credentials`);
  }
}

const bundleDir = join(root, "apps", "web", ".next", "static");
let scannedBundles = 0;
if (existsSync(bundleDir)) {
  for (const file of listAll(bundleDir)) {
    if (BINARY_EXT.test(file) && !file.endsWith(".map")) continue;
    scannedBundles += 1;
    if (PRIVILEGED_NAMES.test(readFileSync(file, "utf8"))) {
      problems.push(`${relative(root, file)}: browser bundle contains a privileged credential name`);
    }
  }
}

if (problems.length > 0) {
  console.error("security-check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`security-check ok (${files.length} files scanned, ${scannedBundles} browser bundle files scanned)`);

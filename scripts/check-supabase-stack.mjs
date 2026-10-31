// Structural guard for infra/supabase (runs in CI; no Docker needed).
//  - the adapted compose keeps the EasyPanel-safe deviations (no container_name, no published ports, unique project name)
//  - every image tag is pinned and identical to the upstream pinned tag (no silent version drift)
//  - every ${VAR} used by the compose is declared in .env.example (or has a default)
//  - secrets in .env.example are empty / placeholders (a filled secret would mean it was committed by mistake)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.SECURITY_CHECK_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "infra", "supabase");
const read = (p) => readFileSync(join(dir, p), "utf8");

const compose = read("docker-compose.yml");
const upstream = read("upstream/docker-compose.upstream.yml");
const envExample = read(".env.example");

const problems = [];
const code = (text) => text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

if (!/^name: triatlo-supabase$/m.test(compose)) problems.push("compose project name must be triatlo-supabase");
if (/^\s*container_name:/m.test(code(compose))) problems.push("compose must not set container_name (EasyPanel compatibility)");
if (/^\s*ports:/m.test(code(compose))) problems.push("compose must not publish ports (PostgreSQL/gateway must stay internal)");
if (/^\s+image: .*:latest\s*$/m.test(code(compose))) problems.push("compose must not use :latest images");

const images = (text) => [...code(text).matchAll(/^\s+image: (\S+)\s*$/gm)].map((m) => m[1]).sort();
const ours = images(compose);
const theirs = images(upstream);
const added = ours.filter((i) => !theirs.includes(i));
const missing = theirs.filter((i) => !ours.includes(i));
// The backup sidecar reuses the database image, so it does not add a new tag.
if (added.length || missing.length) problems.push(`image tags differ from upstream pins: +[${added}] -[${missing}]`);
for (const image of ours) if (!/:[^:]+$/.test(image)) problems.push(`image without explicit tag: ${image}`);

const declared = new Set([...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
for (const m of code(compose).matchAll(/\$\{([A-Z][A-Z0-9_]*)(:-[^}]*(?:\{[^}]*\}[^}]*)*)?\}/g)) {
  const [, name, fallback] = m;
  if (!declared.has(name) && fallback === undefined) problems.push(`\${${name}} is used by the compose but not declared in .env.example`);
}

const SECRET_KEYS = [
  "POSTGRES_PASSWORD", "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
  "JWT_KEYS", "JWT_JWKS", "ANON_KEY_ASYMMETRIC", "SERVICE_ROLE_KEY_ASYMMETRIC", "SECRET_KEY_BASE", "REALTIME_DB_ENC_KEY",
  "VAULT_ENC_KEY", "PG_META_CRYPTO_KEY", "LOGFLARE_PUBLIC_ACCESS_TOKEN", "LOGFLARE_PRIVATE_ACCESS_TOKEN",
  "S3_PROTOCOL_ACCESS_KEY_ID", "S3_PROTOCOL_ACCESS_KEY_SECRET", "MINIO_ROOT_PASSWORD", "DASHBOARD_PASSWORD",
  "BACKUP_ENCRYPTION_PASSPHRASE", "OPENAI_API_KEY",
];
for (const key of SECRET_KEYS) {
  const m = envExample.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) problems.push(`.env.example is missing ${key}`);
  else if (m[1].trim() !== "") problems.push(`.env.example must leave ${key} empty (secrets are generated locally)`);
}
for (const [key, want] of [["DISABLE_SIGNUP", "true"], ["ENABLE_PHONE_SIGNUP", "false"], ["ENABLE_ANONYMOUS_USERS", "false"], ["ENABLE_EMAIL_AUTOCONFIRM", "false"]]) {
  const m = envExample.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m || m[1].trim() !== want) problems.push(`.env.example must set ${key}=${want}`);
}
for (const line of ["GOTRUE_JWT_KEYS", "API_JWT_JWKS", "JWT_JWKS", "SUPABASE_JWKS"]) {
  if (!new RegExp(`^\\s+${line}:`, "m").test(code(compose))) problems.push(`compose must enable ${line} (asymmetric JWT keys)`);
}

if (problems.length) {
  console.error("check-supabase-stack FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`check-supabase-stack ok (${ours.length} images pinned, ${declared.size} variables declared)`);

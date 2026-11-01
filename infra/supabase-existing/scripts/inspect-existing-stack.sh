#!/usr/bin/env bash
# READ-ONLY inspection of the EXISTING Supabase installation (Kong stack) in EasyPanel.
# Run it in a terminal of the SERVER HOST (SSH). It changes NOTHING: only docker ps / inspect / exec of SELECTs.
# It never prints a secret: environment values are compared by SHA-256 against the PUBLIC upstream demo credentials and
# reported as DEFAULT / not default; only an allow-list of non-secret settings (URLs, feature flags) is shown.
#
#   bash inspect-existing-stack.sh [--db <db-container-name>] [--out FILE]
#
# Without --db it looks for the container started from a supabase/postgres image.
set -u
command -v docker >/dev/null 2>&1 || { echo "docker not found: run this on the server host (SSH)" >&2; exit 2; }
DB=""; OUT="${HOME}/supabase-existing-inspection-$(date -u +%Y%m%dT%H%M%SZ).txt"
while [ $# -gt 0 ]; do
  case "$1" in --db) DB="$2"; shift 2 ;; --out) OUT="$2"; shift 2 ;; -h|--help) sed -n '2,12p' "$0"; exit 0 ;; *) echo "unknown option: $1" >&2; exit 2 ;; esac
done
umask 077
exec > >(tee "$OUT") 2>&1
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/../../../supabase/lib/db-guard.sh"

DEMO_HASHES=(
  "1453cea2dc3799e9026e42b3e465e455256d5a149582e4c5b92d4c8d604731a2 JWT_SECRET"
  "fc6a5e9ae75f9160dacd38844789d90a04c85c29c3c95c8c8c6e9da3f58c2365 ANON_KEY"
  "2359b281e1fa0ec38bb10316e2b0e3a7b960fe5d271ee75a4735ff1b313a222c SERVICE_ROLE_KEY"
  "53d3eb3d9500cdcdbbe39c030eb2959438bcc459d5de9380db2a3c85b5de5360 POSTGRES_PASSWORD"
  "80d1c192cf2210c5282179cc9989f4be2e9b24605daabe1bc7da10fd9ed842ed DASHBOARD_PASSWORD"
  "52f004438faf780274c9c95f79d1cf39d2355fbcf035899fc0242b1437f30df3 SECRET_KEY_BASE"
  "9fa03fc1cd78ff85aec9f901f9383bf5c3dfbee93c7da7d5b9f526898a9d7a84 REALTIME_DB_ENC_KEY"
  "0a53c0992edae8ceb04c7a32ee47b49ad0b229c17b073e8c24683111c843d45e VAULT_ENC_KEY"
  "627507f04b33fb434001b83fa1d73b39c7d9a88f2b9a3aec652527a7f0ea571a PG_META_CRYPTO_KEY"
  "4feb5df17e31da658971467f079e9dfa946712c0281386fe631830bdfa1e7332 LOGFLARE_PUBLIC_ACCESS_TOKEN"
  "272b1f97285638be545049c9d56ed0c07b252faf0d47867068482d2b2374a2a9 LOGFLARE_PRIVATE_ACCESS_TOKEN"
  "b0f3a96ded759f6c5f13d27881ffcbfd7821fd6bb5858b0ab819e7a187e46452 S3_PROTOCOL_ACCESS_KEY_ID"
  "7f59edafa4d502ca0156b8fddf28394634d77b1843838b5783a7c9c95fcbd32f S3_PROTOCOL_ACCESS_KEY_SECRET"
  "390d4757bf1b75e305984c99cdedfb1e7c201a2d143a53cfbc35075fa5f9a56f MINIO_ROOT_PASSWORD"
)
sha() { if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | cut -d' ' -f1; else printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; fi; }
label() { docker inspect --format "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null; }
SAFE_NAMES='^(SITE_URL|API_EXTERNAL_URL|SUPABASE_PUBLIC_URL|SUPABASE_URL|ADDITIONAL_REDIRECT_URLS|GOTRUE_SITE_URL|GOTRUE_URI_ALLOW_LIST|DISABLE_SIGNUP|GOTRUE_DISABLE_SIGNUP|ENABLE_EMAIL_SIGNUP|ENABLE_PHONE_SIGNUP|ENABLE_ANONYMOUS_USERS|ENABLE_EMAIL_AUTOCONFIRM|ENABLE_PHONE_AUTOCONFIRM|GOTRUE_EXTERNAL_[A-Z_]*ENABLED|GOTRUE_MAILER_AUTOCONFIRM|GOTRUE_SMS_AUTOCONFIRM|JWT_EXPIRY|GOTRUE_JWT_EXP|POSTGRES_HOST|POSTGRES_PORT|POSTGRES_DB|PGRST_DB_SCHEMAS|FUNCTIONS_VERIFY_JWT|VERIFY_JWT|SMTP_HOST|SMTP_PORT|GOTRUE_SMTP_HOST|STORAGE_BACKEND|FILE_SIZE_LIMIT|ENABLE_IMAGE_TRANSFORMATION|KONG_[A-Z_]*|STUDIO_[A-Z_]*|DEFAULT_ORGANIZATION_NAME|DEFAULT_PROJECT_NAME)$'

echo "# Supabase existing-installation inspection — $(date -u +%FT%TZ)  (no secrets are printed)"
echo "docker: $(docker --version 2>&1)"; echo "compose: $(docker compose version 2>&1 | head -1)"

echo; echo "== 1. Gateway (Kong) and its compose project"
kong="$(docker ps -a --format '{{.Names}}|{{.Image}}' | grep -iE '\|(kong|.*/kong)' | head -n1 | cut -d'|' -f1)"
[ -n "$kong" ] || { echo "no Kong container found"; }
PROJECT=""
if [ -n "$kong" ]; then
  PROJECT="$(label "$kong" com.docker.compose.project)"
  echo "kong container : $kong ($(docker inspect --format '{{.Config.Image}}' "$kong"))"
  echo "compose project: ${PROJECT:-?}"
  echo "working dir    : $(label "$kong" com.docker.compose.project.working_dir)"
  echo "compose files  : $(label "$kong" com.docker.compose.project.config_files)"
fi

echo; echo "== 2. Every container of that project (name | service | image | status/health)"
ids="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}')"
for c in $ids; do
  printf "%s | %s | %s | %s/%s\n" "$c" "$(label "$c" com.docker.compose.service)" "$(docker inspect --format '{{.Config.Image}}' "$c")" \
    "$(docker inspect --format '{{.State.Status}}' "$c")" "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c")"
done
# The database is the compose service "db" running supabase/postgres:<tag>. NEVER match by a substring of the image name:
# "supabase/postgres-meta" also contains "supabase/postgres" and has no psql (that was the earlier mis-identification).
if [ -z "$DB" ]; then DB="$(dg_find_db_container "$PROJECT" 2>/dev/null)" || DB=""; fi
if [ -n "$DB" ]; then
  if dg_assert_db_container "$DB" 2>/tmp/dg.$$; then echo "PostgreSQL container: $DB   (verified: compose service 'db', supabase/postgres image, answers as a Supabase database)"
  else echo "PostgreSQL container: $DB   NOT VERIFIED -> $(cat /tmp/dg.$$)"; DB=""; fi
  rm -f /tmp/dg.$$
else
  echo "PostgreSQL container: NOT FOUND or AMBIGUOUS (compose service 'db' + image supabase/postgres:<tag>); pass --db <name> after checking section 2"
fi

echo; echo "== 3. Published host ports of the project (5432/6543/8000/8443 would be a red flag)"
for c in $ids; do p="$(docker port "$c" 2>/dev/null)"; [ -n "$p" ] && printf "%s -> %s\n" "$c" "$(echo "$p" | tr '\n' ' ')"; done
echo "(nothing above = no published ports)"

echo; echo "== 4. Networks (does the project share a network with OTHER projects' containers?)"
for n in $(for c in $ids; do docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c"; done | tr ' ' '\n' | sort -u); do
  others="$(docker network inspect "$n" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null | tr ' ' '\n' | grep -v '^$' | while read -r x; do [ "$(label "$x" com.docker.compose.project)" != "$PROJECT" ] && echo "$x"; done | wc -l | tr -d ' ')"
  echo "network $n : $others container(s) outside this project attached"
done

echo; echo "== 5. Persistent data (mounts of the database and storage containers)"
for c in $ids; do
  s="$(label "$c" com.docker.compose.service)"; case "$s" in db|storage|*postgres*) 
    echo "-- $c ($s)"; docker inspect --format '{{range .Mounts}}   {{.Type}} {{if .Name}}{{.Name}}{{else}}{{.Source}}{{end}} -> {{.Destination}}{{"\n"}}{{end}}' "$c" ;; esac
done

echo; echo "== 5b. PERSISTENCE RISK: data that lives inside the EasyPanel code/compose directory (bind mounts)"
WD=""; [ -n "$kong" ] && WD="$(label "$kong" com.docker.compose.project.working_dir)"
echo "compose working dir: ${WD:-unknown}"
if [ -n "$WD" ] && [ -d "$WD" ]; then
  echo "is a git work tree : $( (test -d "$WD/.git" && echo yes) || echo no)   (yes = a redeploy may run git pull/reset/clean in this directory)"
  echo "directory listing (names/permissions only; file CONTENTS are never read):"; ls -la "$WD" | sed 's/^/   /' | head -30
  [ -f "$WD/.env" ] && echo "   .env permissions: $(stat -c '%A %U:%G' "$WD/.env" 2>/dev/null || stat -f '%Sp %Su:%Sg' "$WD/.env")  (holds the stack secrets: should not be world-readable)"
  for f in docker-compose.yml compose.yml; do [ -f "$WD/$f" ] && echo "   $f last modified (≈ last deploy/render): $(stat -c '%y' "$WD/$f" 2>/dev/null | cut -d. -f1)"; done
  echo "free space on that filesystem: $(df -h "$WD" | awk 'NR==2{print $4" free of "$2" ("$5" used)"}')"
fi
risky=0
for c in $ids; do
  s="$(label "$c" com.docker.compose.service)"
  while IFS='|' read -r src dst; do
    [ -n "$src" ] || continue
    case "$dst" in /var/lib/postgresql/data|/var/lib/storage|/etc/postgresql-custom|/var/lib/postgresql) kind="DATA" ;; *) continue ;; esac
    where="OUTSIDE the code dir"
    case "$src" in "$WD"/*) where="INSIDE the EasyPanel code dir"; risky=1 ;; /etc/easypanel/*) where="INSIDE /etc/easypanel (managed by the panel)"; risky=1 ;; esac
    echo "-- $c ($s): bind $src -> $dst : $where"
    echo "   size: $(du -sh "$src" 2>/dev/null | cut -f1)   owner/mode: $(stat -c '%U:%G %a' "$src" 2>/dev/null)"
    if [ -f "$src/PG_VERSION" ]; then
      echo "   PG_VERSION born: $(stat -c '%w' "$src/PG_VERSION" 2>/dev/null)   (if this is OLDER than the compose file's last modification above, the data already survived at least one redeploy/render)"
    fi
    if [ -d "$WD/.git" ]; then
      echo "   git: ignored=$(git -C "$WD" check-ignore -q "$src" 2>/dev/null && echo yes || echo no)   untracked/ignored entries here: $(git -C "$WD" status --porcelain --ignored -- "$src" 2>/dev/null | head -3 | tr '\n' ' ')"
    fi
  done < <(docker inspect --format '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}{{end}}' "$c")
  docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}-- '"$c"' ('"$s"'): NAMED VOLUME {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}{{end}}' "$c" | grep -E 'postgresql/data|var/lib/storage|postgresql-custom'
done
if [ "$risky" = 1 ]; then
  echo "RISK: persistent data is stored INSIDE the directory the panel manages. It is lost if the service is destroyed/recreated (documented by EasyPanel),"
  echo "      and may be lost or reset if a deploy re-renders/re-clones that directory. Take backups BEFORE any redeploy and prove persistence with persistence-marker.sh."
else
  echo "no persistent data found inside the panel-managed directory (named volumes or paths outside it)"
fi

echo; echo "== 6. Non-secret settings (allow-list) per container"
for c in $ids; do
  vars="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$c" | grep -E "^($(echo "$SAFE_NAMES" | sed 's/^\^(//; s/)\$$//'))=" )"
  [ -n "$vars" ] && { echo "-- $c"; echo "$vars" | sed 's/^/   /'; }
done

echo; echo "== 7. DEFAULT/DEMO credential check (values are compared by SHA-256; nothing secret is printed)"
found=0
for c in $ids; do
  while IFS= read -r line; do
    name="${line%%=*}"; value="${line#*=}"; [ -n "$value" ] || continue
    h="$(sha "$value")"
    for entry in "${DEMO_HASHES[@]}"; do
      if [ "${entry%% *}" = "$h" ]; then echo "DEFAULT DEMO VALUE: container=$c variable=$name (matches upstream demo ${entry#* })"; found=1; fi
    done
  done < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$c")
done
[ "$found" = 0 ] && echo "no variable of this project equals a public upstream demo value"
echo "(also compare: any password/key that is a short or guessable string must be treated as default even if not listed)"

echo; echo "== 8. Kong declarative config: services and paths only (no keys)"
if [ -n "$kong" ]; then
  for f in /home/kong/kong.yml /home/kong/temp.yml; do
    if docker exec "$kong" sh -c "test -r $f" 2>/dev/null; then
      echo "file: $f"; docker exec "$kong" sh -c "grep -E '^[[:space:]]*(- name:|name:|url:|- /|paths:|_comment:)' $f" 2>/dev/null | grep -viE 'key|secret|token|password' | head -80; break
    fi
  done
fi

echo; echo "== 9. PostgreSQL (SELECT-only queries as supabase_admin)"
if [ -n "$DB" ]; then
  q() { docker exec "$DB" psql -h localhost -U supabase_admin -d postgres -At -c "$1" 2>&1 | head -20; }
  echo "image            : $(docker inspect --format '{{.Config.Image}}' "$DB")"
  echo "server_version   : $(q 'show server_version')"
  echo "pg_isready       : $(docker exec "$DB" pg_isready -U postgres -h localhost 2>&1)"
  echo "database size    : $(q "select pg_size_pretty(pg_database_size('postgres'))")"
  echo "auth.users       : $(q 'select count(*) from auth.users')"
  echo "public tables    : $(q "select count(*) from pg_tables where schemaname='public'")  (RLS off on: $(q "select coalesce(string_agg(relname,','),'none') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"))"
  echo "storage buckets  : $(q 'select count(*) from storage.buckets')"
  echo "schemas          : $(q "select string_agg(nspname, ', ' order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'")"
  echo "migration history: $(q "select count(*) from supabase_migrations.triatlo_applied" | head -1)"
fi

echo; echo "Saved to: $OUT  (mode 600). It contains no secrets and can be sent as is."

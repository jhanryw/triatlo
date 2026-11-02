#!/usr/bin/env bash
# ONE run on the SERVER (SSH) that takes the existing Supabase from "demo credentials, empty database" to "credentials
# corrected, migrations 1-9 applied, tests green". It stops at the single moment that needs the EasyPanel screen.
# Non-destructive: it never drops/recreates volumes or databases; it only reads, backs up, and applies ADDITIVE migrations.
#
#   bash ~/triatlo-ops/infra/supabase-existing/scripts/go-live-server.sh [--db qarvon_supabase-triatlo-db-1] [--out ~/triatlo-backups]
set -euo pipefail
DB="qarvon_supabase-triatlo-db-1"; PROJECT="${DB%-db-1}"; OUT="$HOME/triatlo-backups"
while [ $# -gt 0 ]; do
  case "$1" in --db) DB="$2"; PROJECT="${2%-db-1}"; shift 2 ;; --out) OUT="$2"; shift 2 ;; -h|--help) sed -n '2,8p' "$0"; exit 0 ;; *) echo "unknown option: $1" >&2; exit 2 ;; esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/supabase/lib/db-guard.sh"
step() { printf '\n==== %s\n' "$*"; }

step "1/9 update checkout"; git -C "$ROOT" pull --ff-only; git -C "$ROOT" log --oneline -1
step "2/9 database container identity (guard)"; dg_assert_db_container "$DB" || exit 1
STORAGE="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=storage" --format '{{.Names}}' | head -n1 || true)"
echo "storage container: ${STORAGE:-<not found: Storage files will NOT be backed up>}"
step "3/9 migrations: read-only status and dry-run"
bash "$ROOT/supabase/migrate.sh" --container "$DB" --status
bash "$ROOT/supabase/migrate.sh" --container "$DB" --dry-run
step "4/9 backup + integrity + restore rehearsal (throw-away database, removed afterwards)"
bash "$HERE/backup-existing.sh" --db "$DB" ${STORAGE:+--storage "$STORAGE"} --out "$OUT"
DUMP="$(ls -t "$OUT"/existing-db-*.dump | head -n1)"; echo "dump: $DUMP"
bash "$HERE/restore-rehearsal.sh" --db "$DB" --dump "$DUMP"
step "5/9 persistence marker (a COMMENT on the database; removed at the end)"
bash "$HERE/persistence-marker.sh" set --db "$DB"

cat <<MSG

==== 6/9 NOW, IN EASYPANEL (the only manual moment) — service "supabase-triatlo", tab Environment:
   a) remove the 4 old lines JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, DASHBOARD_PASSWORD
   b) paste the 4 new lines from your Mac:   pbcopy < ~/.triatlo-secrets/supabase-kong-rotation.env
   c) Save, then press Deploy ONCE and wait until it is healthy.
   d) back here: press Enter.
MSG
read -r -p "Enter when the supabase-triatlo deploy finished... " _

step "7/9 persistence check after the redeploy"
for i in $(seq 1 60); do [ "$(docker inspect --format '{{.State.Health.Status}}' "$DB" 2>/dev/null || true)" = healthy ] && break; sleep 5; done
dg_assert_db_container "$DB" || exit 1
RES="$(bash "$HERE/persistence-marker.sh" check --db "$DB" 2>&1 || true)"; echo "$RES"
if ! printf '%s' "$RES" | grep -q PERSISTED; then
  echo "STOP: the marker was not found. Do NOT continue. Your backup is in $OUT (dump: $DUMP). Send me this output." >&2; exit 1
fi
bash "$HERE/persistence-marker.sh" clear --db "$DB"
step "8/9 credentials: any DEFAULT DEMO VALUE left?"
bash "$HERE/inspect-existing-stack.sh" 2>&1 | grep -E "DEFAULT DEMO VALUE|no default" || echo "(no demo value reported)"
step "9/9 apply migrations 1-9 (additive; one transaction per file), then SQL/RLS tests on the real database"
bash "$ROOT/supabase/migrate.sh" --container "$DB"
bash "$ROOT/supabase/migrate.sh" --container "$DB" --status
bash "$ROOT/supabase/tests/run.sh" --production --container "$DB"

cat <<MSG

DONE on the server. Two things left:
 - copy the backup OFF the server (run on your Mac):  scp -r <your-ssh-user>@<server-ip>:triatlo-backups ~/Downloads/triatlo-backups-offsite
 - continue on your Mac (account, web, worker): see docs/GO_LIVE.md
MSG

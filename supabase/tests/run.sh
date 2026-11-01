#!/usr/bin/env bash
# SQL test runner.
#
#   Disposable database (CI / local):   DATABASE_URL=postgresql://user:pw@host:5432/db bash supabase/tests/run.sh
#       stand-ins for a bare PostgreSQL are created, migrations are applied (twice: must be idempotent), tests run.
#
#   The REAL database, AFTER migrations were applied on purpose:   bash supabase/tests/run.sh --production [--container <db>]
#       connection: --container <db> (docker exec psql as supabase_admin), or DATABASE_URL, or the PG* variables
#       - creates NO stand-ins and applies NO migrations; refuses to run if Supabase's auth/storage schemas are missing;
#       - every test file runs inside a transaction that is ROLLED BACK (no row survives);
#       - the helper schema `tests` is dropped at the end, leaving the database exactly as it was.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROD=0; CONTAINER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --production) PROD=1; shift ;;
    --container) CONTAINER="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -n "$CONTAINER" ]; then PSQL=(docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1)
elif [ -n "${DATABASE_URL:-}" ]; then PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1)
elif [ -n "${PGHOST:-}" ]; then PSQL=(psql -X -q -v ON_ERROR_STOP=1)
else echo "set DATABASE_URL (disposable DB), PG* variables, or use --container <db>" >&2; exit 2; fi
[ -z "$CONTAINER" ] || [ "$PROD" = 1 ] || { echo "--container is only for --production" >&2; exit 2; }

run_file() { "${PSQL[@]}" < "$1"; }   # files go through stdin so the same code works with docker exec

if [ "$PROD" = 1 ]; then
  ok="$("${PSQL[@]}" -At -c "select (to_regclass('auth.users') is not null and to_regclass('storage.objects') is not null and to_regclass('supabase_migrations.triatlo_applied') is not null)")"
  [ "$ok" = "t" ] || { echo "REFUSED: auth.users, storage.objects and the migration history must already exist (run migrate.sh first)" >&2; exit 1; }
  run_file "$HERE/00_helpers.sql" >/dev/null
  trap '"${PSQL[@]}" -c "drop schema if exists tests cascade" >/dev/null 2>&1 || true' EXIT
else
  run_file "$HERE/01_standins_bare_postgres.sql"
  run_file "$HERE/00_helpers.sql"
  bash "$HERE/../migrate.sh"
  bash "$HERE/../migrate.sh" | grep -q "0 migration(s) applied"   # idempotent runner
  bash "$HERE/../migrate.sh" --status >/dev/null                  # checksums consistent
fi

fail=0
for f in "$HERE"/[1-9]*.sql; do
  if run_file "$f" >/dev/null 2>"$f.err"; then echo "PASS $(basename "$f")"
  else echo "FAIL $(basename "$f")"; cat "$f.err"; fail=1; fi
  rm -f "$f.err"
done
exit $fail

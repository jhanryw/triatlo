#!/usr/bin/env bash
# SQL test runner.
#
#   Disposable database (CI / local):   DATABASE_URL=postgresql://user:pw@host:5432/db bash supabase/tests/run.sh
#       stand-ins for a bare PostgreSQL are created, migrations are applied (twice: must be idempotent), tests run.
#
#   The REAL database, AFTER migrations were applied on purpose:   bash supabase/tests/run.sh --production
#       (uses DATABASE_URL, or the PG* variables, e.g. inside the compose "backup" container)
#       - creates NO stand-ins and applies NO migrations; refuses to run if Supabase's auth/storage schemas are missing;
#       - every test file runs inside a transaction that is ROLLED BACK (no row survives);
#       - the helper schema `tests` is dropped at the end, leaving the database exactly as it was.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROD=0; [ "${1:-}" = "--production" ] && PROD=1

if [ -n "${DATABASE_URL:-}" ]; then PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1)
elif [ -n "${PGHOST:-}" ]; then PSQL=(psql -X -q -v ON_ERROR_STOP=1)
else echo "set DATABASE_URL (disposable DB) or PG* variables" >&2; exit 2; fi

if [ "$PROD" = 1 ]; then
  ok="$("${PSQL[@]}" -At -c "select (to_regclass('auth.users') is not null and to_regclass('storage.objects') is not null and to_regclass('supabase_migrations.triatlo_applied') is not null)")"
  [ "$ok" = "t" ] || { echo "REFUSED: auth.users, storage.objects and the migration history must already exist (run migrate.sh first)" >&2; exit 1; }
  "${PSQL[@]}" -f "$HERE/00_helpers.sql" >/dev/null
  trap '"${PSQL[@]}" -c "drop schema if exists tests cascade" >/dev/null 2>&1 || true' EXIT
else
  "${PSQL[@]}" -f "$HERE/01_standins_bare_postgres.sql"
  "${PSQL[@]}" -f "$HERE/00_helpers.sql"
  bash "$HERE/../migrate.sh"
  bash "$HERE/../migrate.sh" | grep -q "0 migration(s) applied"   # idempotent runner
  bash "$HERE/../migrate.sh" --status >/dev/null                  # checksums consistent
fi

fail=0
for f in "$HERE"/[1-9]*.sql; do
  case "$(basename "$f")" in 01_*) continue ;; esac
  if "${PSQL[@]}" -f "$f" >/dev/null 2>"$f.err"; then echo "PASS $(basename "$f")"
  else echo "FAIL $(basename "$f")"; cat "$f.err"; fail=1; fi
  rm -f "$f.err"
done
exit $fail

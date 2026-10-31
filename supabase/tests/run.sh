#!/usr/bin/env bash
# Applies the migrations to a THROW-AWAY database and runs every SQL test (each in its own rolled-back transaction).
#   DATABASE_URL=postgresql://user:pw@host:5432/db bash supabase/tests/run.sh
# Never point this at a real database: the prelude may create stand-in roles/schemas.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a disposable database}"
HERE="$(cd "$(dirname "$0")" && pwd)"
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$HERE/00_ci_prelude.sql"
bash "$HERE/../migrate.sh"
# second run must be a no-op (idempotent runner)
bash "$HERE/../migrate.sh" | grep -q "0 migration(s) applied"
fail=0
for f in "$HERE"/[1-9]*.sql; do
  if psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$f.err"; then echo "PASS $(basename "$f")"
  else echo "FAIL $(basename "$f")"; cat "$f.err"; fail=1; fi
  rm -f "$f.err"
done
exit $fail

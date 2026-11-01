#!/usr/bin/env bash
# Applies the versioned SQL migrations in supabase/migrations, in order, each in ONE transaction, recording a checksum.
#
#   DATABASE_URL=postgresql://... bash supabase/migrate.sh [--dry-run|--status]
#   PGHOST=db PGUSER=... PGPASSWORD=... bash supabase/migrate.sh        # libpq variables (e.g. inside the compose "backup" container)
#   bash supabase/migrate.sh --container <db-container-name> [--user supabase_admin] [--db postgres] [--dry-run|--status]
#
#   --dry-run   list what would be applied; strictly read-only (writes nothing, not even the bookkeeping table)
#   --status    read-only: print every migration with applied/pending state and verify the recorded checksums against the files
#               (exit 1 on a checksum mismatch or a recorded migration whose file is missing)
#
# - already-applied migrations are skipped; if an applied file was EDITED afterwards the run STOPS (migrations are immutable);
# - destructive statements (DROP TABLE/SCHEMA/COLUMN/DATABASE, TRUNCATE, DELETE FROM) are REFUSED unless the file carries
#   a line "-- allow-destructive: <reason>" (project rule: no destructive migration without the owner's authorization);
# - never run against production without a verified backup (infra/backup/RESTORE.md).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HERE/migrations"
# shellcheck disable=SC1091
source "$HERE/lib/db-guard.sh"
CONTAINER=""; DB_USER="supabase_admin"; DB_NAME="postgres"; DRY=0; STATUS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --user) DB_USER="$2"; shift 2 ;;
    --db) DB_NAME="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --status) STATUS=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

run_psql() {
  if [ -n "$CONTAINER" ]; then docker exec -i "$CONTAINER" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -X -q -v ON_ERROR_STOP=1 "$@"
  elif [ -n "${DATABASE_URL:-}" ]; then psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"
  elif [ -n "${PGHOST:-}" ]; then psql -X -q -v ON_ERROR_STOP=1 "$@"
  else echo "set DATABASE_URL, PGHOST (+ PG* variables) or use --container" >&2; exit 2; fi
}
# Identity guard BEFORE anything else (read-only): never operate on a container that is not the Supabase database.
if [ -n "$CONTAINER" ]; then dg_assert_db_container "$CONTAINER" || exit 1; else dg_assert_sql_identity || exit 1; fi

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# 1) version guard first: it is read-only and must run before anything is written
PGV="$(run_psql -At -c "show server_version_num" | head -n1)"
if [ "${PGV:-0}" -lt 150000 ]; then
  echo "REFUSED: PostgreSQL 15+ is required (ON DELETE SET NULL (column) in the migrations); server_version_num=$PGV" >&2; exit 1
fi

# 2) bookkeeping. Read-only modes (--dry-run, --status) never write: the table is not even created just to look.
if [ "$DRY" = 1 ] || [ "$STATUS" = 1 ]; then
  if [ "$(run_psql -At -c "select to_regclass('supabase_migrations.triatlo_applied') is not null")" = "t" ]; then
    APPLIED="$(run_psql -At -F '|' -c "select version, checksum from supabase_migrations.triatlo_applied order by version")"
  else
    APPLIED=""
  fi
else
  run_psql -c "create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.triatlo_applied (version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now());" >/dev/null
  APPLIED="$(run_psql -At -F '|' -c "select version, checksum from supabase_migrations.triatlo_applied order by version")"
fi
if [ "$STATUS" = 1 ]; then
  bad=0; seen=""
  for file in "$DIR"/*.sql; do
    base="$(basename "$file" .sql)"; version="${base%%_*}"; sum="$(sha "$file")"
    known="$(printf '%s\n' "$APPLIED" | grep "^$version|" | cut -d'|' -f2 || true)"
    seen="$seen $version"
    if [ -z "$known" ]; then echo "pending   $base"
    elif [ "$known" = "$sum" ]; then echo "applied   $base  ${sum:0:12}…  checksum ok"
    else echo "MISMATCH  $base  recorded ${known:0:12}… != file ${sum:0:12}…"; bad=1; fi
  done
  while IFS='|' read -r version _; do
    [ -n "$version" ] || continue
    case " $seen " in *" $version "*) ;; *) echo "MISSING   recorded migration $version has no file"; bad=1 ;; esac
  done <<< "$APPLIED"
  exit $bad
fi

pending=0
for file in "$DIR"/*.sql; do
  base="$(basename "$file" .sql)"; version="${base%%_*}"; name="${base#*_}"
  [[ "$version" =~ ^[0-9]{14}$ ]] || { echo "bad migration name: $base" >&2; exit 1; }
  [[ "$name" =~ ^[a-z0-9_]+$ ]] || { echo "bad migration name: $base" >&2; exit 1; }
  sum="$(sha "$file")"
  known="$(printf '%s\n' "$APPLIED" | grep "^$version|" | cut -d'|' -f2 || true)"
  if [ -n "$known" ]; then
    [ "$known" = "$sum" ] || { echo "STOP: $base was modified after being applied (checksum mismatch). Create a NEW migration instead." >&2; exit 1; }
    continue
  fi
  if grep -qiE '\b(drop[[:space:]]+(table|schema|column|database)|truncate|delete[[:space:]]+from)\b' "$file" && ! grep -q '^-- allow-destructive:' "$file"; then
    echo "REFUSED: $base contains destructive statements without '-- allow-destructive: <reason>'." >&2; exit 1
  fi
  pending=$((pending+1))
  if [ "$DRY" = 1 ]; then echo "would apply $base"; continue; fi
  echo "applying $base"
  { cat "$file"; printf '\ninsert into supabase_migrations.triatlo_applied (version, name, checksum) values (%s, %s, %s);\n' "'$version'" "'$name'" "'$sum'"; } | run_psql -1
done
if [ "$DRY" != 1 ] && [ "$pending" -gt 0 ]; then
  run_psql -c "notify pgrst, 'reload schema'" >/dev/null 2>&1 || true   # PostgREST also reloads on DDL; this makes it explicit
fi
echo "done ($pending migration(s) $( [ "$DRY" = 1 ] && echo pending || echo applied ))"

#!/usr/bin/env bash
# Applies the versioned SQL migrations in supabase/migrations, in order, each in ONE transaction, recording a checksum.
#
#   DATABASE_URL=postgresql://... bash supabase/migrate.sh [--dry-run]
#   bash supabase/migrate.sh --container <db-container-name> [--user supabase_admin] [--db postgres] [--dry-run]
#
# - already-applied migrations are skipped; if an applied file was EDITED afterwards the run STOPS (migrations are immutable);
# - destructive statements (DROP TABLE/SCHEMA/COLUMN/DATABASE, TRUNCATE, DELETE FROM) are REFUSED unless the file carries
#   a line "-- allow-destructive: <reason>" (project rule: no destructive migration without the owner's authorization);
# - never run against production without a verified backup (infra/backup/RESTORE.md).
set -euo pipefail

DIR="$(cd "$(dirname "$0")/migrations" && pwd)"
CONTAINER=""; DB_USER="supabase_admin"; DB_NAME="postgres"; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --user) DB_USER="$2"; shift 2 ;;
    --db) DB_NAME="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

run_psql() {
  if [ -n "$CONTAINER" ]; then docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -q -v ON_ERROR_STOP=1 "$@"
  else : "${DATABASE_URL:?set DATABASE_URL or use --container}"; psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; fi
}
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

run_psql -c "create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.triatlo_applied (version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now());" >/dev/null

APPLIED="$(run_psql -At -F '|' -c "select version, checksum from supabase_migrations.triatlo_applied order by version")"
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
echo "done ($pending migration(s) $( [ "$DRY" = 1 ] && echo pending || echo applied ))"

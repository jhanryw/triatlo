#!/usr/bin/env bash
# NON-DESTRUCTIVE restore rehearsal: restores a dump into a THROW-AWAY database (restore_test) inside the same PostgreSQL
# server, counts a few things, and drops the throw-away database. The real database "postgres" is never touched.
#
#   bash restore-rehearsal.sh --db <db-container> --dump /path/to/existing-db-<ts>.dump
set -euo pipefail
DB=""; DUMP=""
while [ $# -gt 0 ]; do
  case "$1" in --db) DB="$2"; shift 2 ;; --dump) DUMP="$2"; shift 2 ;; -h|--help) sed -n '2,7p' "$0"; exit 0 ;; *) echo "unknown option: $1" >&2; exit 2 ;; esac
done
[ -n "$DB" ] && [ -f "$DUMP" ] || { echo "usage: --db <container> --dump <file>" >&2; exit 2; }
P() { docker exec -i "$DB" psql -h localhost -U supabase_admin -X -q -At -v ON_ERROR_STOP=1 "$@"; }
[ "$(P -d postgres -c "select count(*) from pg_database where datname='restore_test'")" = 0 ] || { echo "REFUSED: database restore_test already exists (not created by this script run); inspect it first" >&2; exit 1; }
trap 'P -d postgres -c "drop database if exists restore_test" >/dev/null 2>&1 || true' EXIT
P -d postgres -c "create database restore_test"
echo "restoring (warnings about existing roles/extensions are expected)…"
docker exec -i "$DB" pg_restore -h localhost -U supabase_admin --dbname=restore_test --no-owner --no-privileges < "$DUMP" || echo "(pg_restore reported warnings/errors above: review them)"
echo "users in restored copy : $(P -d restore_test -c 'select count(*) from auth.users')"
echo "public tables restored : $(P -d restore_test -c "select count(*) from pg_tables where schemaname='public'")"
echo "migrations recorded    : $(P -d restore_test -c 'select count(*) from supabase_migrations.triatlo_applied' 2>/dev/null || echo 'n/a (none applied yet)')"
echo "REHEARSAL DONE: throw-away database dropped."

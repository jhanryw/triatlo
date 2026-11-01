#!/usr/bin/env bash
# One-off BACKUP of the existing database (and optionally Storage files) BEFORE any schema change.
# Run on the SERVER HOST (SSH). Non-destructive: it only reads from the containers and writes files into --out.
#
#   bash backup-existing.sh --db <db-container> [--storage <storage-container>] [--out DIR]
#
# Produces (mode 600, directory mode 700):
#   existing-db-<UTC>.dump         pg_dump custom format of database "postgres" (all schemas)
#   existing-globals-<UTC>.sql     roles (pg_dumpall --globals-only) — contains password hashes: keep private
#   existing-storage-<UTC>.tar.gz  Storage files, if --storage is given
#   *.sha256                       checksums
# The dump is verified with pg_restore --list. Copy the files OFF the server afterwards (scp/rsync to your computer).
set -euo pipefail
DB=""; STORAGE=""; OUT="$HOME/triatlo-backups"
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --storage) STORAGE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DB" ] || { echo "--db <container> is required (take the name from inspect-existing-stack.sh)" >&2; exit 2; }
docker inspect "$DB" >/dev/null 2>&1 || { echo "container not found: $DB" >&2; exit 1; }
docker exec "$DB" pg_isready -U postgres -h localhost >/dev/null || { echo "database is not ready" >&2; exit 1; }

umask 077; mkdir -p "$OUT"; chmod 700 "$OUT"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$OUT/existing-db-$ts.dump"; globals="$OUT/existing-globals-$ts.sql"
sum() { if command -v sha256sum >/dev/null 2>&1; then (cd "$(dirname "$1")" && sha256sum "$(basename "$1")" > "$(basename "$1").sha256"); else (cd "$(dirname "$1")" && shasum -a 256 "$(basename "$1")" > "$(basename "$1").sha256"); fi; }

echo "dumping database…"
docker exec "$DB" pg_dump -h localhost -U supabase_admin -d postgres --format=custom > "$dump"
echo "verifying archive…"
docker exec -i "$DB" pg_restore --list < "$dump" > /dev/null || { echo "FAILED: dump is not readable by pg_restore" >&2; rm -f "$dump"; exit 1; }
sum "$dump"
echo "dumping roles…"
docker exec "$DB" pg_dumpall -h localhost -U supabase_admin --globals-only > "$globals"; chmod 600 "$globals"
if [ -n "$STORAGE" ]; then
  echo "archiving Storage files…"
  docker cp "$STORAGE:/var/lib/storage" - | gzip > "$OUT/existing-storage-$ts.tar.gz"
  sum "$OUT/existing-storage-$ts.tar.gz"
fi
chmod 600 "$OUT"/existing-*-"$ts"* 2>/dev/null || true
echo; echo "BACKUP COMPLETE in $OUT:"; ls -lh "$OUT"/existing-*-"$ts"*
echo "Next: copy it OFF the server, e.g. from your computer:  scp -r <user>@<server>:$OUT ./"

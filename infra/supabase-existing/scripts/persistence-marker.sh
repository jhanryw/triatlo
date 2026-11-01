#!/usr/bin/env bash
# Proves (or disproves) that the database data survives a redeploy, using a harmless marker: a COMMENT on the database.
# It does NOT touch any table, user or setting. `clear` restores the previous comment exactly.
#
#   bash persistence-marker.sh set   --db <db>     # writes the marker (a tiny write; needs authorization) and stores it in a local file
#   ... redeploy the service in EasyPanel (with NO change), wait for it to be healthy ...
#   bash persistence-marker.sh check --db <db>     # PERSISTED / LOST
#   bash persistence-marker.sh clear --db <db>     # restores the previous comment
set -euo pipefail
ACTION="${1:-}"; shift || true
DB=""; STATE="$HOME/triatlo-backups/persistence-marker.state"
while [ $# -gt 0 ]; do case "$1" in --db) DB="$2"; shift 2 ;; --state) STATE="$2"; shift 2 ;; *) echo "unknown option: $1" >&2; exit 2 ;; esac; done
[ -n "$DB" ] && [ -n "$ACTION" ] || { sed -n '2,10p' "$0"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../../../supabase/lib/db-guard.sh"
dg_assert_db_container "$DB" || exit 1     # identity proven BEFORE any write
Q() { docker exec -i "$DB" psql -h localhost -U supabase_admin -d postgres -X -q -At -v ON_ERROR_STOP=1 "$@"; }
# Always the database of THIS connection (never a hard-coded name).
current() { Q -c "select coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname = current_database()"; }
set_comment() { # $1 = text, empty = remove the comment
  Q -v c="$1" <<'SQL'
select format('comment on database %I is %s', current_database(), case when :'c' = '' then 'null' else quote_literal(:'c') end) as stmt \gset
:stmt
SQL
}
case "$ACTION" in
  set)
    [ ! -f "$STATE" ] || { echo "REFUSED: a marker state already exists at $STATE (run check or clear first)" >&2; exit 1; }
    umask 077; mkdir -p "$(dirname "$STATE")"
    id="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)"; prev="$(current)"
    printf 'id=%s\nprevious_b64=%s\nset_at=%s\n' "$id" "$(printf '%s' "$prev" | base64 | tr -d '\n')" "$(date -u +%FT%TZ)" > "$STATE"
    set_comment "triatlo-persistence-marker:$id"
    echo "marker written (id $id). Now redeploy WITHOUT changes, wait until healthy, then run: check" ;;
  check)
    [ -f "$STATE" ] || { echo "no marker state at $STATE" >&2; exit 1; }
    id="$(grep '^id=' "$STATE" | cut -d= -f2)"
    if [ "$(current)" = "triatlo-persistence-marker:$id" ]; then echo "PERSISTED: the marker survived (the data directory was preserved across the redeploy)"
    else echo "LOST: the marker is gone -> the database was re-initialised. Restore from the backup taken before the redeploy." >&2; exit 1; fi ;;
  clear)
    [ -f "$STATE" ] || { echo "no marker state at $STATE" >&2; exit 1; }
    prev="$(grep '^previous_b64=' "$STATE" | cut -d= -f2- | base64 -d 2>/dev/null || true)"
    set_comment "$prev"
    rm -f "$STATE"; echo "marker removed; previous comment restored" ;;
  *) echo "action must be set|check|clear" >&2; exit 2 ;;
esac

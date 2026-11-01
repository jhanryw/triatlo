#!/usr/bin/env bash
# Identification of the PostgreSQL container and guards that MUST pass before any operation (reads that matter or writes).
# Sourced by: inspect-existing-stack.sh, backup-existing.sh, restore-rehearsal.sh, supabase/migrate.sh, supabase/tests/run.sh.
#
# Why this exists: matching a container by image name (grep 'supabase/postgres') also matches `supabase/postgres-meta`
# (the postgres-meta service has no psql) and caused a wrong identification. The database is identified ONLY as:
#   compose service label == "db"   AND   image == supabase/postgres:<tag>   (never `supabase/postgres-meta`)
# and then PROVEN by running a query that only a Supabase database can answer.
#
# Functions (all print their diagnosis to stderr and return non-zero on failure):
#   dg_find_db_container [PROJECT]   -> prints the single db container name
#   dg_assert_db_container NAME      -> identity + tools + SQL proof (docker exec)
#   dg_assert_sql_identity           -> same SQL proof through the caller's run_psql (DATABASE_URL / PG* modes)

DG_IMAGE_RE='^(docker\.io/)?supabase/postgres:[A-Za-z0-9._-]+$'

dg_label() { docker inspect --format "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null; }

dg_find_db_container() {
  local project="${1:-}" filters=(--filter "label=com.docker.compose.service=db") c image found=() 
  [ -z "$project" ] || filters+=(--filter "label=com.docker.compose.project=$project")
  for c in $(docker ps -a "${filters[@]}" --format '{{.Names}}'); do
    image="$(docker inspect --format '{{.Config.Image}}' "$c" 2>/dev/null)"
    [[ "$image" =~ $DG_IMAGE_RE ]] && found+=("$c")
  done
  case "${#found[@]}" in
    1) printf '%s\n' "${found[0]}" ;;
    0) echo "no container with compose service 'db' and image supabase/postgres:<tag>${project:+ in project $project}" >&2; return 1 ;;
    *) echo "AMBIGUOUS: ${#found[@]} database containers (${found[*]}); pass --db <name> explicitly" >&2; return 2 ;;
  esac
}

dg_assert_db_container() {
  local c="${1:-}" image service state out
  [ -n "$c" ] || { echo "dg: no container name given" >&2; return 2; }
  docker inspect "$c" >/dev/null 2>&1 || { echo "dg: container not found: $c" >&2; return 1; }
  image="$(docker inspect --format '{{.Config.Image}}' "$c")"
  service="$(dg_label "$c" com.docker.compose.service)"
  state="$(docker inspect --format '{{.State.Status}}' "$c")"
  if [[ "$image" == *supabase/postgres-meta* ]]; then
    echo "dg: REFUSED: $c is postgres-meta ($image), not the database. The database is the compose service 'db'." >&2; return 1
  fi
  if ! [[ "$image" =~ $DG_IMAGE_RE ]]; then
    echo "dg: REFUSED: $c runs '$image', expected supabase/postgres:<tag>" >&2; return 1
  fi
  if [ -n "$service" ] && [ "$service" != "db" ]; then
    echo "dg: REFUSED: $c is compose service '$service', expected 'db'" >&2; return 1
  fi
  [ "$state" = "running" ] || { echo "dg: REFUSED: $c is '$state', not running" >&2; return 1; }
  if ! docker exec "$c" sh -c 'command -v psql >/dev/null && command -v pg_dump >/dev/null && command -v pg_restore >/dev/null' >/dev/null 2>&1; then
    echo "dg: REFUSED: psql/pg_dump/pg_restore not found inside $c (wrong container?)" >&2; return 1
  fi
  out="$(docker exec "$c" psql -h localhost -U supabase_admin -d postgres -X -At -c \
    "select (to_regclass('auth.users') is not null) and (to_regnamespace('storage') is not null)" 2>&1)" || {
    echo "dg: REFUSED: cannot query $c as supabase_admin: $(printf '%s' "$out" | head -n1)" >&2; return 1; }
  [ "$out" = "t" ] || { echo "dg: REFUSED: $c does not look like a Supabase database (auth.users/storage missing)" >&2; return 1; }
  echo "dg: ok — $c is the Supabase database (service=${service:-n/a}, image=$image)" >&2
}

# For DATABASE_URL / PG* modes: the caller defines run_psql. The target must be a database that already has Supabase's auth schema.
dg_assert_sql_identity() {
  local out
  out="$(run_psql -At -c "select (to_regclass('auth.users') is not null)" 2>&1)" || { echo "dg: REFUSED: cannot query the target database: $(printf '%s' "$out" | head -n1)" >&2; return 1; }
  [ "$out" = "t" ] || { echo "dg: REFUSED: target database has no auth.users (not a Supabase database; for a bare PostgreSQL create the stand-ins first)" >&2; return 1; }
}

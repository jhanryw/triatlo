#!/usr/bin/env bash
# Unit test of supabase/lib/db-guard.sh with a FAKE `docker` (no Docker, no server needed). It reproduces the incident where the
# postgres-meta container was mistaken for the database, plus other near-misses (stopped, wrong service, not a Supabase DB, ambiguity).
#   bash supabase/tests/guard-test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export FAKE_FIXTURE="$TMP/containers.txt"
# name|project|service|image|state|tools(yes/no)|sql answer ("t","f","ERR")
cat > "$FAKE_FIXTURE" <<'ROWS'
qarvon_supabase-triatlo-db-1|qarvon_supabase-triatlo|db|supabase/postgres:15.8.1.085|running|yes|t
qarvon_supabase-triatlo-meta-1|qarvon_supabase-triatlo|meta|supabase/postgres-meta:v0.96.3|running|no|ERR
qarvon_supabase-triatlo-auth-1|qarvon_supabase-triatlo|auth|supabase/gotrue:v2.186.0|running|no|ERR
qarvon_supabase-triatlo-kong-1|qarvon_supabase-triatlo|kong|kong/kong:3.9.1|running|no|ERR
otherproj-db-1|otherproj|db|postgres:16|running|yes|f
stopped-db-1|stoppedproj|db|supabase/postgres:15.8.1.085|exited|yes|t
wrong-service-1|wrongproj|storage|supabase/postgres:15.8.1.085|running|yes|t
notsupabase-db-1|nsproj|db|supabase/postgres:15.8.1.085|running|yes|f
meta-named-db-1|metaproj|db|supabase/postgres-meta:v0.96.3|running|no|ERR
twin-a-db-1|twin_a|db|supabase/postgres:15.8.1.085|running|yes|t
twin-b-db-1|twin_b|db|supabase/postgres:15.8.1.085|running|yes|t
ROWS
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
# Minimal fake of the docker calls used by supabase/lib/db-guard.sh
row() { grep "^$1|" "$FAKE_FIXTURE"; }
field() { row "$1" | cut -d'|' -f"$2"; }
case "$1" in
  ps)
    shift; project=""; service=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --filter) case "$2" in label=com.docker.compose.project=*) project="${2#*=*=}" ;; label=com.docker.compose.service=*) service="${2#*=*=}" ;; esac; shift 2 ;;
        *) shift ;;
      esac
    done
    while IFS='|' read -r name p s image state tools sql; do
      [ -n "$project" ] && [ "$p" != "$project" ] && continue
      [ -n "$service" ] && [ "$s" != "$service" ] && continue
      echo "$name"
    done < "$FAKE_FIXTURE" ;;
  inspect)
    shift
    if [ "$1" = "--format" ]; then fmt="$2"; name="$3"; else fmt=""; name="$1"; fi
    row "$name" >/dev/null || exit 1
    case "$fmt" in
      *Config.Image*) field "$name" 4 ;;
      *State.Status*) field "$name" 5 ;;
      *compose.service*) field "$name" 3 ;;
      *compose.project*) field "$name" 2 ;;
      "") ;;
    esac ;;
  exec)
    shift; [ "$1" = "-i" ] && shift; name="$1"; shift
    row "$name" >/dev/null || exit 1
    if printf '%s ' "$@" | grep -q "command -v psql"; then [ "$(field "$name" 6)" = yes ] && exit 0 || exit 1; fi
    if printf '%s ' "$@" | grep -q "psql"; then
      if [ "$(field "$name" 6)" != yes ]; then echo 'OCI runtime exec failed: exec: "psql": executable file not found in $PATH' >&2; exit 126; fi
      ans="$(field "$name" 7)"; [ "$ans" = ERR ] && { echo "psql: error" >&2; exit 2; }; echo "$ans"; exit 0
    fi ;;
esac
FAKE
chmod +x "$TMP/bin/docker"; export PATH="$TMP/bin:$PATH"
# shellcheck disable=SC1091
source "$HERE/../lib/db-guard.sh"

FAILS=0
expect_ok()   { if "$@" >/dev/null 2>"$TMP/err"; then echo "PASS  $DESC"; else echo "FAIL  $DESC (should pass): $(head -1 "$TMP/err")"; FAILS=$((FAILS+1)); fi; }
expect_fail() { if "$@" >/dev/null 2>"$TMP/err"; then echo "FAIL  $DESC (should be refused)"; FAILS=$((FAILS+1)); else echo "PASS  $DESC -> $(head -1 "$TMP/err" | cut -c1-110)"; fi; }
want_name() { local got; got="$("$@" 2>/dev/null)"; [ "$got" = "$WANT" ] && echo "PASS  $DESC -> $got" || { echo "FAIL  $DESC (got '$got', want '$WANT')"; FAILS=$((FAILS+1)); }; }

DESC="find: project qarvon_supabase-triatlo resolves to the db service, NOT meta"; WANT="qarvon_supabase-triatlo-db-1"; want_name dg_find_db_container qarvon_supabase-triatlo
DESC="find: a project without a supabase/postgres db finds nothing";                expect_fail dg_find_db_container otherproj
DESC="find: a 'db' service running postgres-meta image is not accepted";            expect_fail dg_find_db_container metaproj
DESC="find: no project + several candidates is AMBIGUOUS (never guessed)";          expect_fail dg_find_db_container
DESC="assert: the real db container passes";                                        expect_ok dg_assert_db_container qarvon_supabase-triatlo-db-1
DESC="assert: postgres-meta is REFUSED (the incident)";                             expect_fail dg_assert_db_container qarvon_supabase-triatlo-meta-1
DESC="assert: auth/kong are refused";                                               expect_fail dg_assert_db_container qarvon_supabase-triatlo-auth-1
DESC="assert: kong is refused";                                                     expect_fail dg_assert_db_container qarvon_supabase-triatlo-kong-1
DESC="assert: plain postgres:16 in another project is refused";                     expect_fail dg_assert_db_container otherproj-db-1
DESC="assert: stopped db container is refused";                                     expect_fail dg_assert_db_container stopped-db-1
DESC="assert: right image but wrong compose service is refused";                    expect_fail dg_assert_db_container wrong-service-1
DESC="assert: db container that does not answer as a Supabase DB is refused";       expect_fail dg_assert_db_container notsupabase-db-1
DESC="assert: unknown container is refused";                                        expect_fail dg_assert_db_container does-not-exist
DESC="assert: empty name is refused";                                               expect_fail dg_assert_db_container ""
# the sql-identity guard used in DATABASE_URL/PG* modes
run_psql() { echo "$FAKE_SQL_ANSWER"; }
FAKE_SQL_ANSWER=t;  DESC="sql identity: auth.users present passes";                 expect_ok dg_assert_sql_identity
FAKE_SQL_ANSWER=f;  DESC="sql identity: auth.users missing is refused";             expect_fail dg_assert_sql_identity
echo; [ "$FAILS" -eq 0 ] && echo "ALL GUARD TESTS PASSED" || { echo "$FAILS GUARD TEST(S) FAILED"; exit 1; }

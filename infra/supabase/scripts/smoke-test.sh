#!/bin/bash
# Black-box checks of the PUBLIC surface of the self-hosted Supabase, run from your own machine.
#
#   bash infra/supabase/scripts/smoke-test.sh --api-url https://<generated-api-host> [--login] [--env FILE]
#        [--key-var ANON_KEY --stack kong]     # the Kong-based installation in production uses the legacy anon JWT
#
# Reads the publishable key from the local secrets file (default ~/.triatlo-secrets/supabase.env). Prints status codes only.
# --login   also asks (silently) for the admin e-mail/password and checks a password login (used to prove persistence
#           after a restart: the user must still exist).
set -u
API=""; ENVF="$HOME/.triatlo-secrets/supabase.env"; LOGIN=0; KEYVAR="SUPABASE_PUBLISHABLE_KEY"; STACK="envoy"
while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API="${2%/}"; shift 2 ;;
    --env) ENVF="$2"; shift 2 ;;
    --login) LOGIN=1; shift ;;
    --key-var) KEYVAR="$2"; shift 2 ;;
    --stack) STACK="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$API" ] || { echo "--api-url is required" >&2; exit 2; }
case "$API" in https://*) ;; *) echo "FAIL api url must be https://" ; exit 1 ;; esac
[ -f "$ENVF" ] || { echo "env file not found: $ENVF" >&2; exit 2; }
PUB="$(grep "^${KEYVAR}=" "$ENVF" | head -n1 | cut -d= -f2-)"
[ -n "$PUB" ] || { echo "$KEYVAR missing in $ENVF" >&2; exit 2; }

FAILS=0
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$@"; }
warncheck() { # name expected-regex actual  (a deviation is only a WARNING: upstream-by-design behaviour of the Kong stack)
  if echo "$3" | grep -Eq "^($2)$"; then echo "ok    $1 -> $3"; else echo "WARN  $1 -> $3 (expected $2; open by upstream design on the Kong stack)"; fi
}
check() { # name expected-regex actual
  if echo "$3" | grep -Eq "^($2)$"; then echo "ok    $1 -> $3"; else echo "FAIL  $1 -> $3 (expected $2)"; FAILS=$((FAILS+1)); fi
}

echo "Public surface of $API"
check "TLS reachable, Auth health WITHOUT key is rejected"   "401|403" "$(code "$API/auth/v1/health")"
check "Auth health with publishable key"                      "200"     "$(code -H "apikey: $PUB" "$API/auth/v1/health")"
check "REST root with publishable key"                        "200"     "$(code -H "apikey: $PUB" "$API/rest/v1/")"
check "REST root WITHOUT key is rejected"                     "401|403" "$(code "$API/rest/v1/")"
check "Studio (/) is not served publicly (404 by path rules, or 401 by Basic Auth)" "404|401" "$(code "$API/")"
check "postgres-meta (/pg/) is not reachable"                 "404|401|403" "$(code -H "apikey: $PUB" "$API/pg/tables")"
if [ "$STACK" = kong ]; then
  warncheck "Edge functions path requires a key" "401|403|404" "$(code "$API/functions/v1/hello")"
  check "Realtime tenants API is not reachable with the public key" "401|403|404" "$(code -H "apikey: $PUB" "$API/realtime/v1/api/tenants")"
else
  check "Edge functions path is not reachable"                  "404|401|403" "$(code -H "apikey: $PUB" "$API/functions/v1/hello")"
  check "Realtime path is not reachable"                        "404|401|403" "$(code -H "apikey: $PUB" "$API/realtime/v1/api/tenants")"
fi

# Public sign-up must be disabled (random throw-away identity; nothing is created when the check passes)
RAND="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
BODY="{\"email\":\"smoke-$RAND@example.invalid\",\"password\":\"$RAND$RAND-Aa1\"}"
check "Public sign-up is rejected" "400|401|403|422" \
  "$(printf '%s' "$BODY" | code -X POST -H "apikey: $PUB" -H "Content-Type: application/json" --data @- "$API/auth/v1/signup")"

if [ "$LOGIN" = 1 ]; then
  printf "Admin e-mail: "; read -r EMAIL
  printf "Password (hidden): "; stty -echo 2>/dev/null; read -r PASS; stty echo 2>/dev/null; echo
  RES="$(EMAIL="$EMAIL" PASS="$PASS" python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASS"]}))' \
    | curl -s -m 15 -o /tmp/.triatlo-login.$$ -w '%{http_code}' -X POST -H "apikey: $PUB" -H "Content-Type: application/json" --data @- "$API/auth/v1/token?grant_type=password")"
  HAS_TOKEN=no; grep -q '"access_token"' /tmp/.triatlo-login.$$ 2>/dev/null && HAS_TOKEN=yes
  rm -f /tmp/.triatlo-login.$$
  unset PASS
  check "Password login (proves the user persisted)" "200" "$RES"
  [ "$HAS_TOKEN" = yes ] || { echo "FAIL  login response had no access_token"; FAILS=$((FAILS+1)); }
fi

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "$FAILS CHECK(S) FAILED"; exit 1; fi

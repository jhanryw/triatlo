#!/usr/bin/env bash
# End-to-end test of the REAL deployment over HTTPS (run from your own machine, no Docker needed):
# authentication, authenticated write/read, anonymous isolation, tenant isolation, column privileges, private Storage.
# It logs in with YOUR account (password typed hidden), writes ONE test check-in dated 2000-01-01 and one tiny test object,
# and deletes both at the end. Nothing secret is printed.
#
#   bash infra/supabase/scripts/integration-test.sh --api-url https://<api-host> [--env FILE]
set -u
API=""; ENVF="$HOME/.triatlo-secrets/supabase.env"
while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API="${2%/}"; shift 2 ;;
    --env) ENVF="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$API" ] || { echo "--api-url is required" >&2; exit 2; }
case "$API" in https://*) ;; *) echo "api url must be https://" >&2; exit 2 ;; esac
PUB="$(grep '^SUPABASE_PUBLISHABLE_KEY=' "$ENVF" | head -n1 | cut -d= -f2-)"
[ -n "$PUB" ] || { echo "publishable key missing in $ENVF" >&2; exit 2; }

TMP="$(mktemp -d)"; chmod 700 "$TMP"
FAILS=0; WARNS=0; TOKEN=""; UID_=""; CHECKIN_ID=""; OBJ=""
cleanup() {
  if [ -n "$TOKEN" ]; then
    [ -n "$CHECKIN_ID" ] && curl -s -o /dev/null -m 20 -X DELETE -H "apikey: $PUB" -H "Authorization: Bearer $TOKEN" "$API/rest/v1/daily_checkins?id=eq.$CHECKIN_ID"
    [ -n "$OBJ" ] && curl -s -o /dev/null -m 20 -X DELETE -H "apikey: $PUB" -H "Authorization: Bearer $TOKEN" "$API/storage/v1/object/meal-photos/$OBJ"
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

pass() { echo "ok    $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
warn() { echo "WARN  $1"; WARNS=$((WARNS+1)); }
expect() { # name regex actual
  if echo "$3" | grep -Eq "^($2)$"; then pass "$1 -> $3"; else fail "$1 -> $3 (expected $2)"; fi
}
code() { curl -s -o "$TMP/body" -m 25 -w '%{http_code}' "$@"; }
json() { python3 -c "import sys,json
try:
    d=json.load(open('$TMP/body'))
except Exception:
    print(''); sys.exit()
$1"; }

echo "Integration test against $API"
printf "Your e-mail: "; read -r EMAIL
printf "Password (hidden): "; stty -echo 2>/dev/null; read -r PASS; stty echo 2>/dev/null; echo

# 1. authentication
S="$(EMAIL="$EMAIL" PASS="$PASS" python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASS"]}))' \
  | code -X POST -H "apikey: $PUB" -H "Content-Type: application/json" --data @- "$API/auth/v1/token?grant_type=password")"
unset PASS
expect "password login" "200" "$S"
TOKEN="$(json "print(d.get('access_token',''))")"
UID_="$(json "print((d.get('user') or {}).get('id',''))")"
[ -n "$TOKEN" ] && [ -n "$UID_" ] || { echo "cannot continue without a session"; exit 1; }
H=(-H "apikey: $PUB" -H "Authorization: Bearer $TOKEN")

# 2. anonymous users cannot reach private records
for t in daily_checkins profiles meals completed_workouts push_subscriptions training_plans background_jobs; do
  expect "anon cannot read $t" "401|403" "$(code -H "apikey: $PUB" "$API/rest/v1/$t?select=*&limit=1")"
done
expect "anon cannot insert a check-in" "401|403" \
  "$(printf '{"checkin_date":"2000-01-02","fatigue_score":3}' | code -X POST -H "apikey: $PUB" -H "Content-Type: application/json" --data @- "$API/rest/v1/daily_checkins")"

# 3. authenticated write and read
S="$(printf '{"checkin_date":"2000-01-01","fatigue_score":3,"notes":"integration-test"}' \
  | code -X POST "${H[@]}" -H "Content-Type: application/json" -H "Prefer: return=representation" --data @- "$API/rest/v1/daily_checkins")"
expect "authenticated insert (own check-in)" "201" "$S"
CHECKIN_ID="$(json "print((d[0] if isinstance(d,list) and d else {}).get('id',''))")"
S="$(code "${H[@]}" "$API/rest/v1/daily_checkins?id=eq.$CHECKIN_ID&select=user_id,quality,checkin_date")"
expect "authenticated read-back" "200" "$S"
R="$(json "r=d[0] if isinstance(d,list) and d else {}; print(r.get('user_id',''), r.get('quality',''))")"
[ "$R" = "$UID_ partial" ] && pass "row belongs to the logged-in user and quality is derived ('partial')" || fail "unexpected row content: $R"
expect "duplicate day is rejected (unique)" "409" \
  "$(printf '{"checkin_date":"2000-01-01","mood_score":2}' | code -X POST "${H[@]}" -H "Content-Type: application/json" --data @- "$API/rest/v1/daily_checkins")"
expect "empty check-in is rejected (check constraint)" "400|409" \
  "$(printf '{"checkin_date":"2000-01-03"}' | code -X POST "${H[@]}" -H "Content-Type: application/json" --data @- "$API/rest/v1/daily_checkins")"

# 4. anonymous still sees nothing after data exists
S="$(code -H "apikey: $PUB" "$API/rest/v1/daily_checkins?id=eq.$CHECKIN_ID&select=id")"
expect "anon cannot read the row that now exists" "401|403" "$S"

# 5. tenant isolation and column privileges
OTHER="00000000-0000-4000-8000-000000000001"
expect "cannot write a row for another user_id" "401|403|409" \
  "$(printf '{"user_id":"%s","checkin_date":"2000-01-04","fatigue_score":2}' "$OTHER" | code -X POST "${H[@]}" -H "Content-Type: application/json" --data @- "$API/rest/v1/daily_checkins")"
expect "push subscription keys are unreadable" "401|403" "$(code "${H[@]}" "$API/rest/v1/push_subscriptions?select=p256dh,auth&limit=1")"
expect "job queue is invisible to the user" "401|403" "$(code "${H[@]}" "$API/rest/v1/background_jobs?select=id&limit=1")"
expect "queue functions are not callable by the user" "401|403|404" "$(printf '{"p_worker":"x"}' | code -X POST "${H[@]}" -H "Content-Type: application/json" --data @- "$API/rest/v1/rpc/claim_background_jobs")"

# 6. private Storage
OBJ="$UID_/integration-test.jpg"
printf '\xff\xd8\xff\xd9' > "$TMP/t.jpg"
expect "upload into own folder" "200|201" "$(code -X POST "${H[@]}" -H "Content-Type: image/jpeg" --data-binary @"$TMP/t.jpg" "$API/storage/v1/object/meal-photos/$OBJ")"
expect "upload into another user's folder is refused" "400|401|403" "$(code -X POST "${H[@]}" -H "Content-Type: image/jpeg" --data-binary @"$TMP/t.jpg" "$API/storage/v1/object/meal-photos/$OTHER/x.jpg")"
expect "anonymous cannot download the object" "400|401|403|404" "$(code -H "apikey: $PUB" "$API/storage/v1/object/meal-photos/$OBJ")"
expect "bucket is not public (public URL does not serve it)" "400|401|403|404" "$(code "$API/storage/v1/object/public/meal-photos/$OBJ")"
S="$(printf '{"expiresIn":60}' | code -X POST "${H[@]}" -H "Content-Type: application/json" --data @- "$API/storage/v1/object/sign/meal-photos/$OBJ")"
expect "owner can create a signed URL" "200" "$S"
SIGNED="$(json "print(d.get('signedURL',''))")"
if [ -n "$SIGNED" ]; then
  S="$(code "$API/storage/v1$SIGNED")"
  if [ "$S" = 200 ]; then pass "signed URL serves the object without any header (works in <img>) -> 200"
  else warn "signed URL returned $S without headers: the gateway may require 'apikey' even for signed URLs (images could not load)"; fi
fi

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL CHECKS PASSED ($WARNS warning(s)). Test row and test object were removed."; else echo "$FAILS CHECK(S) FAILED ($WARNS warning(s))"; exit 1; fi

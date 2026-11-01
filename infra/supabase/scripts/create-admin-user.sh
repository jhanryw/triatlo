#!/bin/bash
# Creates YOUR single account through the Auth admin API (public sign-up stays disabled).
# The password is typed silently, sent over HTTPS from stdin and never written to disk or shell history.
#
#   bash infra/supabase/scripts/create-admin-user.sh --api-url https://<generated-api-host> [--env FILE]
#
# Uses the legacy SERVICE_ROLE_KEY from the local secrets file once, only from this machine, only for this call.
set -u
API=""; ENVF="$HOME/.triatlo-secrets/supabase.env"
while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API="${2%/}"; shift 2 ;;
    --env) ENVF="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$API" ] || { echo "--api-url is required" >&2; exit 2; }
case "$API" in https://*) ;; *) echo "api url must be https://" >&2; exit 2 ;; esac
[ -f "$ENVF" ] || { echo "env file not found: $ENVF" >&2; exit 2; }
SVC="$(grep '^SERVICE_ROLE_KEY=' "$ENVF" | head -n1 | cut -d= -f2-)"
[ -n "$SVC" ] || { echo "SERVICE_ROLE_KEY missing in $ENVF" >&2; exit 2; }

printf "Your e-mail: "; read -r EMAIL
printf "Password (min 12 chars, hidden): "; stty -echo 2>/dev/null; read -r PASS; stty echo 2>/dev/null; echo
printf "Repeat password: "; stty -echo 2>/dev/null; read -r PASS2; stty echo 2>/dev/null; echo
[ "$PASS" = "$PASS2" ] || { echo "passwords differ" >&2; exit 1; }
[ "${#PASS}" -ge 12 ] || { echo "password too short (min 12)" >&2; exit 1; }
unset PASS2

HDR="$(mktemp)"; chmod 600 "$HDR"; trap 'rm -f "$HDR"' EXIT
printf 'apikey: %s\nAuthorization: Bearer %s\nContent-Type: application/json\n' "$SVC" "$SVC" > "$HDR"

STATUS="$(EMAIL="$EMAIL" PASS="$PASS" python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASS"],"email_confirm":True}))' \
  | curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST -H @"$HDR" --data @- "$API/auth/v1/admin/users")"
unset PASS
if [ "$STATUS" = 200 ] || [ "$STATUS" = 201 ]; then echo "account created (HTTP $STATUS). Public sign-up remains disabled."; else echo "failed: HTTP $STATUS" >&2; exit 1; fi

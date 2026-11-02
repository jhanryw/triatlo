#!/bin/sh
# Runs on YOUR MAC (not the server). Prepares everything the EasyPanel screens need, as local files in ~/.triatlo-secrets
# (mode 600). Nothing secret is printed; nothing is sent anywhere. Safe to run again (existing values are reused).
#
#   sh infra/supabase-existing/scripts/prepare-go-live-mac.sh
# Produces:  supabase-kong-rotation.env  -> paste into the ENV of the EasyPanel service "supabase-triatlo" (JWT trio + dashboard password)
#            web.env                     -> paste into the ENV of the service "web"
#            worker.env                  -> paste into the ENV of the NEW service "worker"
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
D="$HOME/.triatlo-secrets"; SRC="$D/supabase.env"
API="https://qarvon-supabase-triatlo.uxxkgy.easypanel.host"; APP="https://qarvon-triatlo.uxxkgy.easypanel.host"
[ -f "$SRC" ] || { echo "missing $SRC (generated earlier by prepare-env.sh)" >&2; exit 1; }
umask 077
get() { grep "^$1=" "$2" | head -n1 | cut -d= -f2-; }

sh "$HERE/make-rotation-env.sh" --keys JWT_SECRET,ANON_KEY,SERVICE_ROLE_KEY,DASHBOARD_PASSWORD

# VAPID keys for Web Push (generated once with the web-push library already pinned in this repository).
if [ ! -s "$D/vapid.env" ]; then
  ( cd "$ROOT" && node -e "const w=require('web-push');const k=w.generateVAPIDKeys();process.stdout.write('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey+'\n')" ) > "$D/vapid.env.tmp"
  mv "$D/vapid.env.tmp" "$D/vapid.env"; chmod 600 "$D/vapid.env"
fi
VPUB="$(get VAPID_PUBLIC_KEY "$D/vapid.env")"; VPRIV="$(get VAPID_PRIVATE_KEY "$D/vapid.env")"
ANON="$(get ANON_KEY "$SRC")"; SVC="$(get SERVICE_ROLE_KEY "$SRC")"
[ -n "$ANON" ] && [ -n "$SVC" ] && [ -n "$VPUB" ] && [ -n "$VPRIV" ] || { echo "a required value is empty" >&2; exit 1; }

# Public values only: the web service NEVER receives the privileged key.
{ echo "NEXT_PUBLIC_SUPABASE_URL=$API"; echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON"; echo "NEXT_PUBLIC_PUSH_ENABLED=true"; echo "NEXT_PUBLIC_VAPID_PUBLIC_KEY=$VPUB"; } > "$D/web.env"
# Backend only.
{ echo "SUPABASE_URL=$API"; echo "SUPABASE_SERVICE_ROLE_KEY=$SVC"; echo "VAPID_PUBLIC_KEY=$VPUB"; echo "VAPID_PRIVATE_KEY=$VPRIV"; echo "VAPID_SUBJECT=$APP"; echo "WORKER_TICK_SECONDS=30"; } > "$D/worker.env"
chmod 600 "$D/web.env" "$D/worker.env"
grep -q "SERVICE_ROLE" "$D/web.env" && { echo "BUG: privileged key in web.env" >&2; rm -f "$D/web.env"; exit 1; }
echo "ready in $D (mode 600): supabase-kong-rotation.env web.env worker.env vapid.env"
echo "copy one to the clipboard without showing it, e.g.:  pbcopy < $D/web.env   (clear later with: pbcopy < /dev/null)"

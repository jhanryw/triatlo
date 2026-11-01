#!/bin/sh
# Builds the MINIMAL local file used to correct demo credentials on the existing (Kong) installation, from secrets that
# were already generated locally with the official generator (~/.triatlo-secrets/supabase.env). Values are never printed.
# Only the legacy HS256 trio is compatible with the Kong stack; opaque/asymmetric keys are deliberately NOT copied.
#
#   sh make-rotation-env.sh [--keys JWT_SECRET,ANON_KEY,SERVICE_ROLE_KEY[,DASHBOARD_PASSWORD,...]] [--from FILE] [--out FILE]
set -eu
FROM="$HOME/.triatlo-secrets/supabase.env"; OUT="$HOME/.triatlo-secrets/supabase-kong-rotation.env"
KEYS="JWT_SECRET,ANON_KEY,SERVICE_ROLE_KEY"
while [ $# -gt 0 ]; do
  case "$1" in --keys) KEYS="$2"; shift 2 ;; --from) FROM="$2"; shift 2 ;; --out) OUT="$2"; shift 2 ;; -h|--help) sed -n '2,8p' "$0"; exit 0 ;; *) echo "unknown option: $1" >&2; exit 2 ;; esac
done
[ -f "$FROM" ] || { echo "source file not found: $FROM" >&2; exit 1; }
for k in $(echo "$KEYS" | tr ',' ' '); do
  case "$k" in SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|ANON_KEY_ASYMMETRIC|SERVICE_ROLE_KEY_ASYMMETRIC|JWT_KEYS|JWT_JWKS)
    echo "refused: $k is an Envoy-stack key and is not compatible with the Kong installation" >&2; exit 1 ;; esac
done
umask 077; tmp="$OUT.tmp"; : > "$tmp"
for k in $(echo "$KEYS" | tr ',' ' '); do
  v="$(grep "^$k=" "$FROM" | head -n1 | cut -d= -f2-)"
  [ -n "$v" ] || { rm -f "$tmp"; echo "missing $k in $FROM" >&2; exit 1; }
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
done
mv "$tmp" "$OUT"; chmod 600 "$OUT"
echo "wrote $OUT (mode 600): $(cut -d= -f1 "$OUT" | tr '\n' ' ')"

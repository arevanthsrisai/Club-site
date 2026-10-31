#!/usr/bin/env bash
# verify.sh — prove the running site actually serves the built app.
#
# Works before DNS exists: by default it tests the box end-to-end through
# nginx on loopback (http://127.0.0.1) while sending the Host header the real
# domain will use. After DNS + Cloudflare go live, re-run with:
#   BASE=https://your.domain ./verify.sh
#
# Usage:
#   HOST=relu.example.org [BASE=http://127.0.0.1] [PUBLIC_ASSET=/avatars/a.png] ./verify.sh
set -uo pipefail

BASE="${BASE:-http://127.0.0.1}"
HOST="${HOST:-relu.example.org}"
PUBLIC_ASSET="${PUBLIC_ASSET:-}"

FAIL=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

HEALTH_CODE=$(curl -sS -o "$TMP/body" -w '%{http_code}' -H "Host: $HOST" "$BASE/api/health")
HEALTH_CT=$(curl -sSI -H "Host: $HOST" "$BASE/api/health" | grep -i '^content-type:' | tr -d '\r' || true)
echo "  status: $HEALTH_CODE $HEALTH_CT"
cat "$TMP/body"; echo
if [ "$HEALTH_CODE" != "200" ] || ! grep -qEq '"status"[[:space:]]*:[[:space:]]*"ok"' "$TMP/body" || \
   ! echo "$HEALTH_CT" | grep -q 'application/json'; then
    echo "  FAIL: health endpoint not healthy"; FAIL=1
else
    echo "  OK"
fi

echo "== 2. Homepage renders =="
HOME_CODE=$(curl -sS -o "$TMP/home" -w '%{http_code}' -H "Host: $HOST" "$BASE/")
HOME_CT=$(curl -sSI -H "Host: $HOST" "$BASE/" | grep -i '^content-type:' | tr -d '\r' || true)
echo "  status: $HOME_CODE $HOME_CT"
if [ "$HOME_CODE" != "200" ] || ! echo "$HOME_CT" | grep -q 'text/html'; then
    echo "  FAIL: homepage not 200 text/html"; FAIL=1
fi
# A real render: Next hydration script plus app content must both be present.
if ! grep -qi '_next' "$TMP/home" || ! grep -q '<html' "$TMP/home"; then
    echo "  FAIL: homepage HTML missing Next.js markup or empty"; FAIL=1
else
    BYTES=$(wc -c < "$TMP/home"); echo "  OK ($BYTES bytes of HTML)"
fi

echo "== 3. First _next/static asset loads with correct MIME =="
ASSET=$(grep -o '/_next/static/[^"'"'"')<> ]*\.\(js\|css\)' "$TMP/home" | head -1 || true)
if [ -z "$ASSET" ]; then
    echo "  FAIL: no _next/static asset referenced from homepage HTML"; FAIL=1
else
    A_CODE=$(curl -sS -o "$TMP/asset" -w '%{http_code}' -H "Host: $HOST" "$BASE$ASSET")
    A_CT=$(curl -sSI -H "Host: $HOST" "$BASE$ASSET" | grep -i '^content-type:' | tr -d '\r' || true)
    echo "  $ASSET -> $A_CODE $A_CT"
    # text/plain here is the classic misconfigured-static bug.
    if [ "$A_CODE" != "200" ] || echo "$A_CT" | grep -qi 'text/plain' || \
       { echo "$ASSET" | grep -q '\.js$' && ! echo "$A_CT" | grep -qi 'javascript'; } || \
       { echo "$ASSET" | grep -q '\.css$' && ! echo "$A_CT" | grep -qi 'css'; }; then
        echo "  FAIL: static asset missing or wrong content type"; FAIL=1
    else
        echo "  OK"
    fi
fi

echo "== 4. Public asset =="
if [ -n "$PUBLIC_ASSET" ]; then
    P_CODE=$(curl -sS -o "$TMP/pub" -w '%{http_code}' -H "Host: $HOST" "$BASE$PUBLIC_ASSET")
    P_CT=$(curl -sSI -H "Host: $HOST" "$BASE$PUBLIC_ASSET" | grep -i '^content-type:' | tr -d '\r' || true)
    echo "  $PUBLIC_ASSET -> $P_CODE $P_CT"
    if [ "$P_CODE" != "200" ] || echo "$P_CT" | grep -qi 'text/plain'; then
        echo "  FAIL: public asset missing or wrong content type"; FAIL=1
    else
        echo "  OK"
    fi
else
    echo "  skipped (set PUBLIC_ASSET=/path-in-public to check one)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
    echo "VERIFY PASS ($BASE, Host: $HOST)"
else
    echo "VERIFY FAIL — see individual checks above"
    exit 1
fi

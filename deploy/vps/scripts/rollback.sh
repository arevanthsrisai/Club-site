#!/usr/bin/env bash
# rollback.sh — point 'current' at the previous release and restart.
set -euo pipefail

ROOT=/opt/relu-website
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"

CURRENT_TARGET=$(readlink "$CURRENT" 2>/dev/null || true)
echo "Current release: ${CURRENT_TARGET:-none}"

PREV=$(ls -1dt "$RELEASES"/*/ 2>/dev/null | sed -e 's:/$::' -e "s:^$RELEASES/::" | grep -vF "${CURRENT_TARGET##*/}" | head -1 || true)
if [ -z "$PREV" ]; then
    echo "No previous release found to roll back to." >&2
    exit 1
fi

echo "Rolling back: ${CURRENT_TARGET##*/} -> $PREV"
ln -sfn "$RELEASES/$PREV" "$ROOT/.current.new"
mv -T "$ROOT/.current.new" "$CURRENT"
/usr/bin/sudo /bin/systemctl restart relu-website.service
bash "$ROOT/repo/deploy/vps/scripts/verify.sh"

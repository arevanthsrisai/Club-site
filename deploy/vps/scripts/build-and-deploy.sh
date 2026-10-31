#!/usr/bin/env bash
# build-and-deploy.sh — build on the VPS and put a new release live.
#
# Runs as the `relu` deploy user. Requires:
#   - git clone of this repo at /opt/relu-website/repo (see DEPLOY.md)
#   - build-time vars in /opt/relu-website/repo/.env.production.local
#     (only the public NEXT_PUBLIC_FIREBASE_* values; matches the gitignore
#     pattern .env*.local so it can never be committed)
#   - runtime secrets already at /etc/relu-website/runtime.env (root-only)
#   - sudoers: NOPASSWD systemctl restart relu-website (see DEPLOY.md)
set -euo pipefail

ROOT=/opt/relu-website
REPO="$ROOT/repo"
RELEASES="$ROOT/releases"

echo "==> Pulling latest code"
cd "$REPO"
git fetch --all --prune
git reset --hard origin/main   # deploy checkout: local edits here are accidents, discard them

if [ ! -f "$REPO/.env.production.local" ]; then
    echo "FATAL: $REPO/.env.production.local missing. Create it from deploy/vps/env/build.env.example" >&2
    exit 1
fi

echo "==> Installing dependencies"
npm ci

echo "==> Building with build-time env vars"
set -a
source "$REPO/.env.production.local"
set +a
NEXT_TELEMETRY_DISABLED=1 npm run build

echo "==> Assembling release"
TS=$(date +%Y%m%d-%H%M%S)
STAGE="$RELEASES/.tmp-$TS"
mkdir -p "$STAGE"
# standalone runtime (server.js, traced node_modules, minimal .next)
cp -r "$REPO/.next/standalone/." "$STAGE/"
# client chunks must sit next to the standalone server at .next/static
mkdir -p "$STAGE/.next"
cp -r "$REPO/.next/static" "$STAGE/.next/static"
# and public/ beside server.js so nginx can serve it directly.
# Newer Next.js standalone output already ships a PARTIAL public/ (per-file
# tracing, e.g. only avatars were captured in this repo) — appending with
# `cp -r public $STAGE/public` would nest it. Replace it wholesale so every
# file under the repo's public/ is served.
rm -rf "$STAGE/public"
cp -r "$REPO/public" "$STAGE/public"
mv "$STAGE" "$RELEASES/$TS"

echo "==> Activating release $TS"
ln -sfn "$RELEASES/$TS" "$ROOT/.current.new"
mv -T "$ROOT/.current.new" "$ROOT/current"   # atomic-ish symlink swap

echo "==> Restarting service"
/usr/bin/sudo /bin/systemctl restart relu-website.service

echo "==> Verifying"
bash "$REPO/deploy/vps/scripts/verify.sh"

echo "Done. Release $TS is live."

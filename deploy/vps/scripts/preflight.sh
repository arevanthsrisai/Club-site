#!/usr/bin/env bash
# preflight.sh — read-only inventory of the VPS BEFORE you change anything.
#
# Run it on the Ubuntu box as the user you will deploy with:
#   bash deploy/vps/scripts/preflight.sh
# Every check is passive (no installs, no config edits, no DNS). Use the
# output to compare the box against DEPLOY.md §1 and decide whether anything
# must be installed or is already there. Exit code: 0 = looks deployable,
# 1 = at least one HARD blocker found. Warn-level findings print as "CHECK"
# and do not fail, because they are fixable decisions, not blockers.
set -u

FAILS=0

label() { printf '\n== %s ==\n' "$1"; }

say()    { echo "  $1"; }
ok()     { say "PASS: $1"; }
check_() { say "CHECK: $1"; }   # decision needed, not a blocker
fail()   { say "FAIL: $1"; FAILS=$((FAILS + 1)); }

label "Identity"
say "whoami: $(id -un), groups: $(id -Gn | tr ' ' ',')"
if sudo -n true 2>/dev/null; then
    ok "passwordless sudo is available (needed for the install steps)"
else
    check_ "passwordless sudo NOT available; each install step will prompt for a password"
fi

label "Operating system / architecture"
if command -v lsb_release >/dev/null 2>&1; then
    OS="$(lsb_release -ds 2>/dev/null | tr -d '"')"
else
    OS="$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"')"
fi
ARCH="$(uname -m)"
KERNEL="$(uname -r)"
say "$OS  ($ARCH, kernel $KERNEL)"
case "$OS" in
    *22.04*|*24.04*) ok "Ubuntu 22.04/24.04, supported by DEPLOY.md" ;;
    *Ubuntu*|*Debian*) check_ "sibling distro/release; DEPLOY.md steps should work but are only tested on 22.04/24.04" ;;
    *) check_ "not clearly Ubuntu; DEPLOY.md assumes apt + ufw" ;;
esac

label "Resources"
MEM_MB="$(free -m | awk '/^Mem:/{print $2}')"
SWAP_MB="$(free -m | awk '/^Swap:/{print $2}')"
DISK_AVAIL="$(df -m / | awk 'NR==2{print $4}')"
if [ "${MEM_MB:-0}" -ge 1800 ] || [ "${SWAP_MB:-0}" -ge 1024 ]; then
    ok "RAM ${MEM_MB:-?}MB, swap ${SWAP_MB:-?}MB — enough headroom for a next build (~1.5–2GB peak)"
else
    check_ "RAM ${MEM_MB:-?}MB, swap ${SWAP_MB:-?}MB — a next build peaks ~1.5–2GB; add 2GB swap if npm ci/build is OOM-killed"
fi
if [ "${DISK_AVAIL:-0}" -lt 3000 ]; then
    check_ "only ${DISK_AVAIL:-?}MB free on / — releases + node_modules want ~2–3GB"
else
    ok "${DISK_AVAIL:-?}MB free on / (want ≥3GB for releases)"
fi

label "Toolchain"
for cmd in git curl node npm nginx ufw systemctl python3; do
    if command -v "$cmd" >/dev/null 2>&1; then
        vs="$("$cmd" --version 2>&1 | head -1)"
        say "ok: $cmd — ${vs}"
    else
        say "missing: $cmd"
    fi
done
if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$NODE_MAJOR" = "22" ]; then
        ok "Node $(node -v) matches engines.node (22.x)"
    else
        check_ "Node $(node -v); the app pins engines.node 22.x — install Node 22 (NodeSource setup_22.x)"
    fi
else
    check_ "No Node.js yet — install Node 22 per DEPLOY.md §1"
fi
command -v nginx >/dev/null 2>&1 && ok "nginx present" || check_ "nginx not installed yet (DEPLOY.md §1)"
command -v python3 >/dev/null 2>&1 || check_ "python3 missing — the runtime.env sanity check (DEPLOY.md §3) uses it"

label "Ports 80 / 443 / 3000 and what holds them"
PORTS_USED="$(ss -tln 2>/dev/null | awk '$4 ~ /:(80|443|3000)$/ {print $4}')"
[ -n "$PORTS_USED" ] && say "$PORTS_USED"
if ss -tln 2>/dev/null | grep -qE ':80\s*$'; then
    check_ "port 80 already listening (existing nginx/Apache?) — run: sudo ss -tlnp | grep -E ':(80|443)\\s'"
else
    ok "port 80 free for nginx"
fi
ss -tln 2>/dev/null | grep -qE ':443\s*$' && check_ "port 443 already listening — conflicts with the Phase-2 origin-certificate listener" || ok "port 443 free"
if ss -tln 2>/dev/null | grep -qE ':3000\s*$'; then
    check_ "port 3000 already listening — identify it before deploying; the app binds 127.0.0.1:3000"
else
    ok "port 3000 free"
fi

label "Existing web/server surface"
if [ -d /etc/nginx/sites-enabled ]; then
    ls /etc/nginx/sites-enabled/ 2>/dev/null | sed 's/^/  sites-enabled: /'
    [ -f /etc/nginx/sites-enabled/default ] && check_ "sites-enabled/default exists — DEPLOY.md §4 removes it (it owns the port-80 default_server)"
fi
command -v apache2 >/dev/null 2>&1 && check_ "apache2 installed — check 'systemctl is-active apache2'"
command -v caddy >/dev/null 2>&1 && check_ "caddy installed — may also want port 80/443"
[ -d /etc/docker ] && say "/etc/docker exists (containers may already occupy ports)"
for svc in "$HOME/.config/systemd" /etc/httpd /var/www; do
    [ -e "$svc" ] && say "pre-existing: $svc"
done

label "Firewall (ufw)"
if command -v ufw >/dev/null 2>&1; then
    say "(sudo ufw status; printing now, may prompt):"
    sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null || say "  run manually: sudo ufw status"
else
    check_ "ufw not installed — decide a firewall mechanism before opening 80/443"
fi
check_ "confirm your SSH session stays alive before any 'ufw enable'; keep the console session open"

label "Deployment layout expectations (DEPLOY.md §0)"
for p in /opt/relu-website /opt/relu-website/repo /opt/relu-website/releases /etc/relu-website/runtime.env /etc/nginx/sites-enabled/relu-website.conf /etc/systemd/system/relu-website.service; do
    [ -e "$p" ] && say "exists: $p  $(ls -ld "$p" | awk '{print $1}')" || say "absent: $p"
done

echo
if [ "$FAILS" -gt 0 ]; then
    echo "RESULT: $FAILS BLOCKER(S) — resolve them before DEPLOY.md."
    exit 1
fi
echo "RESULT: preflight OK — resolve each CHECK item yourself; they are decisions, not blockers."

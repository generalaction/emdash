#!/usr/bin/env bash
# setup-headless-runner.sh — install the full Emdash desktop app on the home
# server and run it HEADLESS under Xvfb, so it polls the local emdash-server
# event queue and runs agents (claude) on the server itself.
#
# This is iteration 1 (prove-it-works): manual launch, no systemd. See
# docs/superpowers/specs/2026-06-05-headless-server-agent-runner-design.md
#
# Run this FROM YOUR MAC (the repo root's machine). It rsyncs the repo to the
# server, builds the .deb there (native modules compile for the correct target),
# installs it, applies your exported project config, and prints how to launch.
#
# Prereqs on the server: x86_64 Linux, sudo, internet. emdash-server already
# deployed (via deploy.sh). Node 18+ available to the SSH user.
#
# Usage:
#   # 1) On your Mac, export the project config first:
#   ./export-project-config.sh doc-engine /opt/projects/doc-engine ./project-config.sql
#
#   # 2) Then run this:
#   REPO_CLONE_URL=git@github.com:you/doc-engine.git ./setup-headless-runner.sh
#
# Env vars:
#   EMDASH_SERVER_HOST   default home-server.local
#   EMDASH_SERVER_USER   default $(whoami)
#   APP_DIR              default /opt/emdash-app        (build dir on server)
#   PROJECT_PATH         default /opt/projects/doc-engine
#   REPO_CLONE_URL       required unless the checkout already exists on server
#   CONFIG_SQL           default ./project-config.sql   (from export step)
set -euo pipefail

SSH_HOST="${EMDASH_SERVER_HOST:-home-server.local}"
SSH_USER="${EMDASH_SERVER_USER:-$(whoami)}"
APP_DIR="${APP_DIR:-/opt/emdash-app}"
PROJECT_PATH="${PROJECT_PATH:-/opt/projects/doc-engine}"
REPO_CLONE_URL="${REPO_CLONE_URL:-}"
CONFIG_SQL="${CONFIG_SQL:-./project-config.sql}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SSH="ssh ${SSH_USER}@${SSH_HOST}"

# Shell snippet (sourced inside remote heredocs) that resolves the installed
# Emdash binary. productName='Emdash' → executable 'emdash', usually under
# /opt/Emdash/emdash. Falls back to dpkg's file list.
RESOLVE_BIN='BIN="$(command -v emdash 2>/dev/null || true)"; [ -z "$BIN" ] && BIN="$(ls /opt/*/emdash 2>/dev/null | head -1)"; [ -z "$BIN" ] && BIN="$(dpkg -L emdash 2>/dev/null | grep -E "/emdash$" | grep -v "\." | head -1)"'

echo "════════════════════════════════════════════════════════════"
echo " Emdash headless runner setup → ${SSH_USER}@${SSH_HOST}"
echo "   app build dir:  ${APP_DIR}"
echo "   project path:   ${PROJECT_PATH}"
echo "════════════════════════════════════════════════════════════"

# ── 0. Preflight ──────────────────────────────────────────────────────────────
if ! $SSH 'echo ok' >/dev/null 2>&1; then
  echo "✗ Cannot SSH to ${SSH_USER}@${SSH_HOST}. Check connectivity / host." >&2
  exit 1
fi
ARCH="$($SSH 'uname -m')"
if [[ "$ARCH" != "x86_64" ]]; then
  echo "✗ Server arch is ${ARCH}; this script targets x86_64 (the Linux build)." >&2
  echo "  For ARM you must add an arm64 electron-builder target + rebuild." >&2
  exit 1
fi
echo "→ Server reachable, arch ${ARCH}. OK."

# ── 1. System packages: Xvfb + Electron/Chromium runtime libs ────────────────
echo ""
echo "→ [1/6] Installing Xvfb + Electron runtime libraries..."
$SSH 'sudo apt-get update -q && sudo apt-get install -y -q \
  xvfb \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
  libatspi2.0-0 libdrm2 libgbm1 libxcb-dri3-0 libasound2 libxshmfence1 \
  git'

# ── 2. Sync repo + build the .deb ON the server ──────────────────────────────
echo ""
echo "→ [2/6] Syncing repo to ${APP_DIR} and building (.deb) on the server..."
$SSH "sudo mkdir -p '${APP_DIR}' && sudo chown '${SSH_USER}:${SSH_USER}' '${APP_DIR}'"

# rsync the source tree (exclude heavy/irrelevant dirs). Native modules are
# rebuilt on the server, so we never ship Mac-built binaries.
rsync -az --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='out' \
  --exclude='dist' \
  --exclude='release' \
  --exclude='docs/' \
  "${REPO_ROOT}/" \
  "${SSH_USER}@${SSH_HOST}:${APP_DIR}/"

echo "   → Installing deps + building on the server (this takes several minutes)..."
$SSH bash <<REMOTE
set -euo pipefail
cd "${APP_DIR}"

# Build toolchain for native modules (node-pty, better-sqlite3).
if ! command -v make &>/dev/null; then
  sudo apt-get install -y -q build-essential python3
fi

# Prefer pnpm if the repo uses it; fall back to npm.
if command -v pnpm &>/dev/null; then PM=pnpm; else
  sudo npm install -g pnpm && PM=pnpm
fi

echo "   → \$PM install (postinstall rebuilds node-pty + better-sqlite3 for Linux)..."
\$PM install

echo "   → Building Linux .deb (electron-builder)..."
\$PM run package:linux

echo "   → Build output:"
ls -lh release/*.deb dist_electron/*.deb 2>/dev/null || find . -name '*.deb' -newermt '-10 min' 2>/dev/null
REMOTE

# ── 3. Install the .deb ──────────────────────────────────────────────────────
echo ""
echo "→ [3/6] Installing the .deb..."
$SSH bash <<REMOTE
set -euo pipefail
cd "${APP_DIR}"
DEB="\$(find . -name '*.deb' -newermt '-15 min' 2>/dev/null | head -1)"
if [[ -z "\$DEB" ]]; then
  echo "✗ No freshly built .deb found under ${APP_DIR}." >&2
  exit 1
fi
echo "   → Installing \$DEB"
sudo apt-get install -y "\$(realpath "\$DEB")" || sudo dpkg -i "\$DEB" || true
sudo apt-get install -f -y -q   # fix any missing deps
${RESOLVE_BIN}
echo "   → Installed binary: \${BIN:-<not found — check 'dpkg -L emdash'>}"
REMOTE

# ── 4. Project checkout ──────────────────────────────────────────────────────
echo ""
echo "→ [4/6] Ensuring project checkout at ${PROJECT_PATH}..."
$SSH bash <<REMOTE
set -euo pipefail
if [[ -d "${PROJECT_PATH}/.git" ]]; then
  echo "   → Checkout already exists. Pulling latest."
  git -C "${PROJECT_PATH}" pull --ff-only || echo "   (pull skipped/failed — continuing)"
else
  if [[ -z "${REPO_CLONE_URL}" ]]; then
    echo "✗ ${PROJECT_PATH} does not exist and REPO_CLONE_URL was not set." >&2
    echo "  Re-run with: REPO_CLONE_URL=git@github.com:you/repo.git ..." >&2
    exit 1
  fi
  sudo mkdir -p "\$(dirname "${PROJECT_PATH}")"
  sudo chown "${SSH_USER}:${SSH_USER}" "\$(dirname "${PROJECT_PATH}")"
  echo "   → Cloning ${REPO_CLONE_URL}"
  git clone "${REPO_CLONE_URL}" "${PROJECT_PATH}"
fi
REMOTE

# ── 5. Apply project config to the headless app's DB ─────────────────────────
echo ""
echo "→ [5/6] Applying project config to the app DB..."
if [[ ! -f "${CONFIG_SQL}" ]]; then
  echo "✗ ${CONFIG_SQL} not found. Run ./export-project-config.sh first." >&2
  exit 1
fi
# Launch the app once headless to let it run migrations + create the DB, then
# stop it, then import. (First boot under Xvfb initializes ~/.config/emdash.)
echo "   → Initializing app DB (first headless boot, ~20s)..."
$SSH bash <<REMOTE
set -euo pipefail
${RESOLVE_BIN}
if [ -z "\$BIN" ]; then echo "✗ Emdash binary not found after install." >&2; exit 1; fi
mkdir -p "\$HOME/.config/emdash"
# Boot headless briefly so migrations create emdash4.db, then kill it.
( xvfb-run -a "\$BIN" --no-sandbox >/tmp/emdash-init.log 2>&1 & echo \$! >/tmp/emdash-init.pid ) || true
sleep 20
kill "\$(cat /tmp/emdash-init.pid)" 2>/dev/null || true
pkill -f "\$BIN" 2>/dev/null || true
sleep 2
ls -la "\$HOME/.config/emdash/emdash4.db" 2>/dev/null || echo "   (DB not found yet — check /tmp/emdash-init.log)"
REMOTE

echo "   → Copying + importing config SQL..."
scp "${CONFIG_SQL}" "${SSH_USER}@${SSH_HOST}:/tmp/project-config.sql"
$SSH 'sqlite3 "$HOME/.config/emdash/emdash4.db" < /tmp/project-config.sql && echo "   → Config imported."'

# ── 6. Launch instructions ───────────────────────────────────────────────────
echo ""
echo "→ [6/6] Setup complete."
echo ""
echo "════════════════════════════════════════════════════════════"
echo " NEXT STEPS (manual for iteration 1)"
echo "════════════════════════════════════════════════════════════"
echo ""
echo " 1. Copy your Claude credentials to the server (subscription login):"
echo "      scp -r ~/.claude ~/.claude.json ${SSH_USER}@${SSH_HOST}:~/"
echo ""
echo " 2. Configure git push auth on the checkout (so commits can push):"
echo "      ${SSH} 'cd ${PROJECT_PATH} && git remote -v'"
echo "      # ensure a deploy key / token is set up for that remote"
echo ""
echo " 3. DISABLE the emdash-server connection on your MAC (Settings), so only"
echo "    the server polls the queue. Otherwise both run each event."
echo ""
echo " 4. Launch the headless runner ON the server:"
echo "      ${SSH}"
echo "      BIN=\$(command -v emdash || ls /opt/*/emdash | head -1)   # e.g. /opt/Emdash/emdash"
echo "      xvfb-run -a \"\$BIN\" --no-sandbox &"
echo ""
echo " 5. Watch it boot + poll:"
echo "      ${SSH} 'tail -f ~/.config/emdash/logs/emdash.log'"
echo "      # expect: AutomationScheduler ... + WebhookWatcher: started polling"
echo ""
echo " 6. Fire the webhook and watch for a commit:"
echo "      curl -X POST http://${SSH_HOST}:8080/webhook/<token>"
echo "      ${SSH} 'cd ${PROJECT_PATH} && git log --oneline -3'"
echo ""
echo " The webhook token (preserved from your Mac's config):"
$SSH 'sqlite3 "$HOME/.config/emdash/emdash4.db" "SELECT \"   POST /webhook/\" || webhook_token FROM automations WHERE webhook_token IS NOT NULL;"' 2>/dev/null || true

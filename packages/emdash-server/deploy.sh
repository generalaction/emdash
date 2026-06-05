#!/usr/bin/env bash
# deploy.sh — install or update rundash-server on a remote host via SSH + pm2
#
# Usage:
#   ./deploy.sh                  # deploy app only
#   ./deploy.sh --tunnel         # deploy app, then run tunnel setup
#   ./deploy.sh --tunnel-only    # run tunnel setup without deploying app
set -euo pipefail

# Accept both RUNDASH_* (new) and EMDASH_* (legacy) env vars.
SSH_HOST="${RUNDASH_SERVER_HOST:-${EMDASH_SERVER_HOST:-home-server.local}}"
SSH_USER="${RUNDASH_SERVER_USER:-${EMDASH_SERVER_USER:-$(whoami)}}"
REMOTE_DIR="${RUNDASH_SERVER_DIR:-${EMDASH_SERVER_DIR:-/opt/rundash-server}}"
PM2_APP_NAME="rundash-server"
SETUP_TUNNEL=false
TUNNEL_ONLY=false

for arg in "$@"; do
  [[ "$arg" == "--tunnel" ]] && SETUP_TUNNEL=true
  [[ "$arg" == "--tunnel-only" ]] && TUNNEL_ONLY=true SETUP_TUNNEL=true
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Tunnel-only shortcut ──────────────────────────────────────────────────────
if $TUNNEL_ONLY; then
  RUNDASH_SERVER_HOST="$SSH_HOST" \
  RUNDASH_SERVER_USER="$SSH_USER" \
    "$SCRIPT_DIR/setup-tunnel.sh" "${@/--tunnel-only/}"
  exit 0
fi

# ── Build locally first ──────────────────────────────────────────────────────
echo "→ Building rundash-server..."
cd "$SCRIPT_DIR"
npm run build

# ── Sync to server ───────────────────────────────────────────────────────────
echo "→ Syncing to ${SSH_USER}@${SSH_HOST}:${REMOTE_DIR} ..."
ssh "${SSH_USER}@${SSH_HOST}" "sudo mkdir -p '${REMOTE_DIR}' && sudo chown '${SSH_USER}:${SSH_USER}' '${REMOTE_DIR}'"

rsync -az --delete \
  --exclude='node_modules' \
  --exclude='src' \
  --exclude='*.test.*' \
  --exclude='.gitignore' \
  --exclude='vitest.config.*' \
  --exclude='tsconfig.json' \
  --exclude='drizzle.config.ts' \
  "${SCRIPT_DIR}/" \
  "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/"

# ── Remote setup ─────────────────────────────────────────────────────────────
echo "→ Installing dependencies and running migrations on server..."
ssh "${SSH_USER}@${SSH_HOST}" bash <<REMOTE
set -euo pipefail
cd "${REMOTE_DIR}"

# Ensure build tools are present (needed to compile better-sqlite3)
if ! command -v make &>/dev/null; then
  echo "  → Installing build tools (make, g++, python3)..."
  sudo apt-get install -y -q build-essential python3
fi

# Install production deps
echo "  → Running npm install..."
npm install --omit=dev

# Rebuild better-sqlite3 native addon only if the binary is missing
SQLITE_NODE=\$(find ./node_modules/better-sqlite3 -name 'better_sqlite3.node' 2>/dev/null | head -1)
if [ -z "\$SQLITE_NODE" ]; then
  echo "  → Compiling better-sqlite3 native addon (this takes ~1 min)..."
  npm rebuild better-sqlite3
  echo "  → Compilation done."
else
  echo "  → better-sqlite3 binary found at \$SQLITE_NODE, skipping rebuild."
fi

# Ensure config exists (config.ts falls back to .emdash-server if present;
# otherwise initialises at .rundash-server).
if [ ! -f "\${HOME}/.rundash-server/config.json" ] && [ ! -f "\${HOME}/.emdash-server/config.json" ]; then
  echo "  → Running 'rundash-server init' (first install)..."
  node dist/cli.js init
  echo ""
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  IMPORTANT: save the API key printed above.         │"
  echo "  │  You will need it to configure Rundash desktop.     │"
  echo "  └─────────────────────────────────────────────────────┘"
  echo ""
else
  echo "  → Config already exists, skipping init."
fi

# Run any new DB migrations
echo "  → Running DB migrations..."
node dist/cli.js migrate

# Install pm2 globally if missing
if ! command -v pm2 &>/dev/null; then
  echo "  → Installing pm2 globally..."
  sudo npm install -g pm2
  echo "  → pm2 installed."
else
  echo "  → pm2 already installed (\$(pm2 --version))."
fi

# Handle legacy pm2 process name (emdash-server → rundash-server)
if pm2 describe "emdash-server" &>/dev/null && ! pm2 describe "${PM2_APP_NAME}" &>/dev/null; then
  echo "  → Renaming pm2 process emdash-server → ${PM2_APP_NAME}..."
  pm2 stop emdash-server
  pm2 delete emdash-server
fi

# Start or reload the process
echo "  → Checking pm2 process status..."
if pm2 describe "${PM2_APP_NAME}" &>/dev/null; then
  echo "  → Reloading existing pm2 process..."
  pm2 reload "${PM2_APP_NAME}"
else
  echo "  → Starting rundash-server with pm2..."
  pm2 start "${REMOTE_DIR}/dist/cli.js" \
    --name "${PM2_APP_NAME}" \
    --interpreter node \
    -- start
  pm2 save
  echo ""
  echo "  To make it survive reboots, run on the server:"
  echo "    pm2 startup"
  echo "  and follow the printed instruction."
fi

echo ""
pm2 status "${PM2_APP_NAME}"
REMOTE

echo ""
echo "✓ rundash-server deployed to ${SSH_HOST}"
echo ""
echo "  Webhook endpoint:  http://${SSH_HOST}:8080/webhook/<token>"
echo "  Health check:      http://${SSH_HOST}:8080/api/health"
echo "  Server logs:       ssh ${SSH_USER}@${SSH_HOST} 'pm2 logs ${PM2_APP_NAME}'"

# ── Tunnel setup (optional) ───────────────────────────────────────────────────
if $SETUP_TUNNEL; then
  echo ""
  RUNDASH_SERVER_HOST="$SSH_HOST" \
  RUNDASH_SERVER_USER="$SSH_USER" \
    "$SCRIPT_DIR/setup-tunnel.sh"
fi

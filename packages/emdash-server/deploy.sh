#!/usr/bin/env bash
# deploy.sh — install or update emdash-server on home-server.local via SSH + pm2
set -euo pipefail

SSH_HOST="${EMDASH_SERVER_HOST:-home-server.local}"
SSH_USER="${EMDASH_SERVER_USER:-$(whoami)}"
REMOTE_DIR="${EMDASH_SERVER_DIR:-/opt/emdash-server}"
PM2_APP_NAME="emdash-server"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Build locally first ──────────────────────────────────────────────────────
echo "→ Building emdash-server..."
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
SQLITE_NODE=$(find ./node_modules/better-sqlite3 -name 'better_sqlite3.node' 2>/dev/null | head -1)
if [ -z "\$SQLITE_NODE" ]; then
  echo "  → Compiling better-sqlite3 native addon (this takes ~1 min)..."
  npm rebuild better-sqlite3
  echo "  → Compilation done."
else
  echo "  → better-sqlite3 binary found at \$SQLITE_NODE, skipping rebuild."
fi

# Ensure emdash-server config exists (skips if already initialised)
if [ ! -f "\${HOME}/.emdash-server/config.json" ]; then
  echo "  → Running 'emdash-server init' (first install)..."
  node dist/cli.js init
  echo ""
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  IMPORTANT: save the API key printed above.         │"
  echo "  │  You will need it to configure Emdash desktop.      │"
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
  echo "  → pm2 already installed ($(pm2 --version))."
fi

# Start or reload the process
echo "  → Checking pm2 process status..."
if pm2 describe "${PM2_APP_NAME}" &>/dev/null; then
  echo "  → Reloading existing pm2 process..."
  pm2 reload "${PM2_APP_NAME}"
else
  echo "  → Starting emdash-server with pm2..."
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
echo "✓ emdash-server deployed to ${SSH_HOST}"
echo ""
echo "  Webhook endpoint:  http://${SSH_HOST}:8080/webhook/<token>"
echo "  Health check:      http://${SSH_HOST}:8080/api/health"
echo "  Server logs:       ssh ${SSH_USER}@${SSH_HOST} 'pm2 logs ${PM2_APP_NAME}'"

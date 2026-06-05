#!/usr/bin/env bash
# setup-tunnel.sh — install and configure cloudflared tunnel on home-server
#
# Usage:
#   ./setup-tunnel.sh                        # interactive first-time setup
#   ./setup-tunnel.sh --reinstall-service    # re-register the systemd service only
#
# What it does:
#   1. Installs cloudflared on the server
#   2. Walks you through `cloudflared tunnel login` (opens browser on your Mac)
#   3. Creates a named tunnel and DNS route
#   4. Writes the tunnel config file
#   5. Installs cloudflared as a systemd service and starts it
#
# Prerequisites:
#   - TUNNEL_HOSTNAME must be set (e.g. server.rundash.dev)
#   - The domain must be on the same Cloudflare account you log into
set -euo pipefail

SSH_HOST="${EMDASH_SERVER_HOST:-home-server.local}"
SSH_USER="${EMDASH_SERVER_USER:-$(whoami)}"
TUNNEL_NAME="${TUNNEL_NAME:-rundash-server}"
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-}"
LOCAL_PORT="${EMDASH_SERVER_PORT:-8080}"
REINSTALL_SERVICE=false

for arg in "$@"; do
  [[ "$arg" == "--reinstall-service" ]] && REINSTALL_SERVICE=true
done

if [ -z "$TUNNEL_HOSTNAME" ]; then
  echo "Error: TUNNEL_HOSTNAME is required."
  echo ""
  echo "  Example:"
  echo "    TUNNEL_HOSTNAME=server.rundash.dev ./setup-tunnel.sh"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Cloudflare Tunnel setup"
echo "  Host:     ${SSH_USER}@${SSH_HOST}"
echo "  Tunnel:   ${TUNNEL_NAME}"
echo "  Public:   https://${TUNNEL_HOSTNAME}"
echo "  Local:    http://localhost:${LOCAL_PORT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: Install cloudflared ───────────────────────────────────────────────
echo "→ Installing cloudflared on ${SSH_HOST}..."
ssh "${SSH_USER}@${SSH_HOST}" bash <<'REMOTE'
set -euo pipefail
if command -v cloudflared &>/dev/null; then
  echo "  → cloudflared already installed ($(cloudflared --version 2>&1 | head -1))."
  exit 0
fi
echo "  → Downloading cloudflared..."
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list > /dev/null
sudo apt-get update -q
sudo apt-get install -y -q cloudflared
echo "  → cloudflared installed ($(cloudflared --version 2>&1 | head -1))."
REMOTE

if $REINSTALL_SERVICE; then
  echo "→ Skipping login/tunnel creation (--reinstall-service mode)."
else
  # ── Step 2: Authenticate ──────────────────────────────────────────────────────
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  MANUAL STEP REQUIRED"
  echo ""
  echo "  A browser window will open on the server side. Since"
  echo "  the server is headless, cloudflared will print a URL"
  echo "  — open it on THIS Mac to authenticate."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  read -r -p "Press Enter when ready to authenticate with Cloudflare..."
  echo ""

  ssh -t "${SSH_USER}@${SSH_HOST}" "cloudflared tunnel login"

  # ── Step 3: Create tunnel ─────────────────────────────────────────────────────
  echo ""
  echo "→ Creating tunnel '${TUNNEL_NAME}'..."
  ssh "${SSH_USER}@${SSH_HOST}" bash <<REMOTE
set -euo pipefail
if cloudflared tunnel list 2>/dev/null | grep -q "${TUNNEL_NAME}"; then
  echo "  → Tunnel '${TUNNEL_NAME}' already exists, skipping create."
else
  cloudflared tunnel create "${TUNNEL_NAME}"
  echo "  → Tunnel created."
fi
REMOTE

  # ── Step 4: Create DNS route ──────────────────────────────────────────────────
  echo "→ Creating DNS route ${TUNNEL_HOSTNAME} → ${TUNNEL_NAME}..."
  ssh "${SSH_USER}@${SSH_HOST}" \
    "cloudflared tunnel route dns '${TUNNEL_NAME}' '${TUNNEL_HOSTNAME}'" || \
    echo "  → DNS route may already exist, continuing."
fi

# ── Step 5: Write config file ─────────────────────────────────────────────────
echo "→ Writing tunnel config..."
ssh "${SSH_USER}@${SSH_HOST}" bash <<REMOTE
set -euo pipefail
TUNNEL_ID=\$(cloudflared tunnel list 2>/dev/null | awk '/${TUNNEL_NAME}/ {print \$1}' | head -1)
if [ -z "\$TUNNEL_ID" ]; then
  echo "Error: could not find tunnel ID for '${TUNNEL_NAME}'. Run without --reinstall-service to create it."
  exit 1
fi
CONFIG_DIR="\${HOME}/.cloudflared"
mkdir -p "\$CONFIG_DIR"
cat > "\${CONFIG_DIR}/config.yml" <<CONFIG
tunnel: \${TUNNEL_ID}
credentials-file: /root/.cloudflared/\${TUNNEL_ID}.json

ingress:
  - hostname: ${TUNNEL_HOSTNAME}
    service: http://localhost:${LOCAL_PORT}
  - service: http_status:404
CONFIG
echo "  → Config written to \${CONFIG_DIR}/config.yml (tunnel ID: \${TUNNEL_ID})"
REMOTE

# ── Step 6: Install and start systemd service ─────────────────────────────────
echo "→ Installing cloudflared systemd service..."
ssh "${SSH_USER}@${SSH_HOST}" bash <<REMOTE
set -euo pipefail

# Copy credentials to root's home so the systemd service (runs as root) can read them
sudo mkdir -p /root/.cloudflared
sudo cp -r "\${HOME}/.cloudflared/." /root/.cloudflared/
sudo chmod 600 /root/.cloudflared/*.json 2>/dev/null || true
sudo chmod 600 /root/.cloudflared/cert.pem 2>/dev/null || true
echo "  → Credentials copied to /root/.cloudflared"

sudo cloudflared --config /root/.cloudflared/config.yml service install 2>/dev/null || true
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared
sleep 2
STATUS=\$(sudo systemctl is-active cloudflared 2>&1)
if [ "\$STATUS" = "active" ]; then
  echo "  → cloudflared service is running."
else
  echo "  → Warning: cloudflared service status: \$STATUS"
  echo "  → Check logs with: sudo journalctl -u cloudflared -n 50"
fi
REMOTE

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Cloudflare Tunnel active"
echo ""
echo "  Public webhook endpoint:"
echo "    https://${TUNNEL_HOSTNAME}/webhook/<token>"
echo ""
echo "  Health check:"
echo "    https://${TUNNEL_HOSTNAME}/api/health"
echo ""
echo "  Tunnel logs:"
echo "    ssh ${SSH_USER}@${SSH_HOST} 'sudo journalctl -u cloudflared -f'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

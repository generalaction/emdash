#!/usr/bin/env bash
# setup-runner.sh — set up the Dockerized agent runner ON the server.
#
# Run this ON THE SERVER (after rundash-server is deployed via deploy.sh). It is
# idempotent — safe to re-run. It:
#   1. checks/installs Docker and adds you to the docker group
#   2. builds the rundash-runner image
#   3. clones (or updates) the target repo
#   4. prompts for the Claude OAuth token (claude setup-token) and stores it
#   5. adds/updates an automation in ~/.rundash-server/config.json
#   6. enables the runner and restarts rundash-server (pm2)
#
# Usage (on the server):
#   cd /opt/rundash-server           # where deploy.sh synced the package
#   ./setup-runner.sh \
#       --token   wh_810f6d8cfca484d05543d034c678c22a520724b2d0813e41 \
#       --repo    https://github.com/you/doc-engine.git \
#       --path    /opt/projects/doc-engine \
#       --prompt  "Review the repo for exploitable security vulnerabilities."
#
# Flags (all optional except --token; --repo required on first run for a path
# that doesn't exist yet):
#   --token TOKEN     webhook token this automation responds to (matches the
#                     token in your webhook URL). REQUIRED.
#   --repo  URL       git URL to clone if --path doesn't exist yet.
#   --path  DIR       host checkout path (default /opt/projects/<repo-name>).
#   --prompt TEXT     the agent prompt (default: a security-scan prompt).
#   --image NAME      runner image tag (default rundash-runner:latest).
#   --push            enable `git push` after the run (default off).
#   --oauth-token TOK provide the Claude OAuth token non-interactively
#                     (default: prompted, hidden — preferred so it isn't in
#                     shell history).
#   --config PATH     config.json path (default: ~/.rundash-server/config.json,
#                     falling back to ~/.emdash-server/config.json if it exists).
#   --pm2-name NAME   pm2 app name (default rundash-server).
#   --skip-image      don't (re)build the Docker image.
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
TOKEN=""
REPO_URL=""
REPO_PATH=""
PROMPT="Review the repository for validated high-impact security vulnerabilities. Focus on authentication, authorization, injection, secret handling, unsafe filesystem or shell usage, SSRF, deserialization, and privilege boundaries. Only report or fix exploitable issues."
IMAGE="rundash-runner:latest"
PUSH=false
OAUTH_TOKEN=""
# Prefer ~/.rundash-server; fall back to legacy ~/.emdash-server if it exists.
if [[ -f "${HOME}/.emdash-server/config.json" ]] && [[ ! -f "${HOME}/.rundash-server/config.json" ]]; then
  CONFIG_PATH="${HOME}/.emdash-server/config.json"
else
  CONFIG_PATH="${HOME}/.rundash-server/config.json"
fi
PM2_NAME="rundash-server"
SKIP_IMAGE=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --path) REPO_PATH="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --push) PUSH=true; shift ;;
    --oauth-token) OAUTH_TOKEN="$2"; shift 2 ;;
    --config) CONFIG_PATH="$2"; shift 2 ;;
    --pm2-name) PM2_NAME="$2"; shift 2 ;;
    --skip-image) SKIP_IMAGE=true; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

err() { echo "✗ $*" >&2; exit 1; }
info() { echo "→ $*"; }

[[ -n "$TOKEN" ]] || err "--token is required (the webhook token this automation responds to)."

# Default repo path from the repo name if not given.
if [[ -z "$REPO_PATH" ]]; then
  if [[ -n "$REPO_URL" ]]; then
    name="$(basename "$REPO_URL" .git)"
    REPO_PATH="/opt/projects/${name}"
  else
    err "--path is required (or pass --repo to derive it)."
  fi
fi

echo "════════════════════════════════════════════════════════════"
echo " rundash-server agent runner setup"
echo "   config:  ${CONFIG_PATH}"
echo "   token:   ${TOKEN}"
echo "   repo:    ${REPO_PATH}${REPO_URL:+  (clone ${REPO_URL})}"
echo "   image:   ${IMAGE}"
echo "   push:    ${PUSH}"
echo "════════════════════════════════════════════════════════════"

# ── 0. Host tooling: jq + git ─────────────────────────────────────────────────
# git is needed on the HOST to clone the repo (the container has its own git for
# pull/commit/push inside the run). jq is needed to edit config.json.
MISSING_PKGS=()
command -v jq &>/dev/null || MISSING_PKGS+=(jq)
command -v git &>/dev/null || MISSING_PKGS+=(git)
if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
  info "Installing host packages: ${MISSING_PKGS[*]}..."
  sudo apt-get update -q && sudo apt-get install -y -q "${MISSING_PKGS[@]}"
fi

# ── 1. Docker ─────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
fi
if ! docker info &>/dev/null; then
  info "Adding ${USER} to the docker group (you must re-login or run 'newgrp docker')..."
  sudo usermod -aG docker "$USER" || true
  if ! sudo docker info &>/dev/null; then
    err "Docker daemon not running. Start it (sudo systemctl start docker) and re-run."
  fi
  echo "  ⚠️  You're not yet in the docker group for this shell."
  echo "     This run will use 'sudo docker'. Re-login afterwards so pm2/node can"
  echo "     run docker without sudo (the runner spawns 'docker', not 'sudo docker')."
  DOCKER="sudo docker"
else
  DOCKER="docker"
fi

# ── 2. Build the runner image ─────────────────────────────────────────────────
if $SKIP_IMAGE; then
  info "Skipping image build (--skip-image)."
else
  [[ -d "${SCRIPT_DIR}/runner" ]] || err "runner/ dir not found next to this script (${SCRIPT_DIR}/runner)."
  info "Building ${IMAGE} (this can take a few minutes)..."
  $DOCKER build -t "${IMAGE}" "${SCRIPT_DIR}/runner"
fi

# ── 3. Clone / update the repo ────────────────────────────────────────────────
if [[ -d "${REPO_PATH}/.git" ]]; then
  info "Repo exists at ${REPO_PATH}; pulling latest..."
  git -C "${REPO_PATH}" pull --ff-only || echo "  (pull skipped/failed — continuing)"
else
  [[ -n "$REPO_URL" ]] || err "${REPO_PATH} doesn't exist and --repo was not given."
  info "Cloning ${REPO_URL} → ${REPO_PATH}..."
  sudo mkdir -p "$(dirname "${REPO_PATH}")"
  sudo chown "${USER}:${USER}" "$(dirname "${REPO_PATH}")"
  git clone "${REPO_URL}" "${REPO_PATH}"
fi

# ── 4. Claude OAuth token ─────────────────────────────────────────────────────
if [[ -z "$OAUTH_TOKEN" ]]; then
  echo ""
  echo "Paste your Claude OAuth token (from 'claude setup-token' on a logged-in"
  echo "machine). Input is hidden. Leave blank to keep any existing token in config."
  read -rs -p "  CLAUDE_CODE_OAUTH_TOKEN: " OAUTH_TOKEN
  echo ""
fi

# ── 5. Update config.json (idempotent) ────────────────────────────────────────
[[ -f "$CONFIG_PATH" ]] || err "Config not found at ${CONFIG_PATH}. Run deploy.sh first to initialise it."

info "Updating ${CONFIG_PATH}..."
TMP="$(mktemp)"
PUSH_JSON=$([[ "$PUSH" == true ]] && echo true || echo false)

# jq program: ensure runner enabled; set oauth token (only if provided);
# upsert the automation by token.
jq \
  --arg token "$TOKEN" \
  --arg repoPath "$REPO_PATH" \
  --arg prompt "$PROMPT" \
  --arg image "$IMAGE" \
  --argjson push "$PUSH_JSON" \
  --arg oauth "$OAUTH_TOKEN" \
  '
  .runner = (.runner // {}) |
  .runner.enabled = true |
  .runner.pollIntervalMs = (.runner.pollIntervalMs // 5000) |
  .runner.maxConcurrent = (.runner.maxConcurrent // 1) |
  (if ($oauth | length) > 0 then .claudeOauthToken = $oauth else . end) |
  .automations = (.automations // []) |
  .automations = (
    [ .automations[] | select(.token != $token) ]
    + [ { token: $token, repoPath: $repoPath, prompt: $prompt, image: $image, push: $push } ]
  )
  ' "$CONFIG_PATH" > "$TMP"

# Validate it is still parseable JSON before overwriting.
jq empty "$TMP" || err "Generated config is invalid JSON; left ${CONFIG_PATH} untouched (see ${TMP})."
mv "$TMP" "$CONFIG_PATH"
chmod 600 "$CONFIG_PATH"
info "Config updated (runner enabled; automation for token ${TOKEN} upserted)."

# ── 6. Restart rundash-server ────────────────────────────────────────────────
if command -v pm2 &>/dev/null && pm2 describe "${PM2_NAME}" &>/dev/null; then
  info "Restarting pm2 process '${PM2_NAME}'..."
  pm2 restart "${PM2_NAME}"
else
  echo "  ⚠️  pm2 process '${PM2_NAME}' not found. Start the server yourself:"
  echo "       pm2 start dist/cli.js --name ${PM2_NAME} --interpreter node -- start"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
PORT="$(jq -r '.port // 8080' "$CONFIG_PATH")"
echo ""
echo "✓ Runner setup complete."
echo ""
echo "  Verify it started:"
echo "    pm2 logs ${PM2_NAME}            # expect: 'runner started: N automation(s)...'"
echo ""
echo "  Fire a test run:"
echo "    curl -X POST http://localhost:${PORT}/webhook/${TOKEN} \\"
echo "      -H 'Content-Type: application/json' -d '{}'"
echo ""
echo "  Watch for a commit:"
echo "    git -C ${REPO_PATH} log --oneline -3"
echo ""
if [[ "$DOCKER" == "sudo docker" ]]; then
  echo "  ⚠️  Re-login (or reboot) so the node process can run 'docker' without sudo,"
  echo "      otherwise runs will fail with a docker permission error."
fi

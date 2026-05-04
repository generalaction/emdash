#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Emdash BYOI provision script
#
# Called by emdash when a new task is created on a BYOI project. Spins up a
# fresh Docker container, clones this repo into it, and prints the JSON that
# emdash needs to SSH into the container.
#
# Requirements on the host: docker, jq
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

IMAGE_NAME="emdash-byoi-workspace"
CONTAINER_USER="devuser"
CONTAINER_PASS="devpass"
WORKSPACE_PATH="/home/devuser/workspace"

# The Dockerfile lives next to this script (inside testing/byoi/ or wherever
# you copied these files).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILE_DIR="$(dirname "$SCRIPT_DIR")"

# ── Preflight checks ──────────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker is not installed or not on PATH" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed. Install with: brew install jq" >&2
  exit 1
fi

# ── Build image if not present ────────────────────────────────────────────────

if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo "Building Docker image '$IMAGE_NAME' (first run only, takes ~2-3 min)..." >&2
  docker build -t "$IMAGE_NAME" "$DOCKERFILE_DIR" >&2
fi

# ── Start container ───────────────────────────────────────────────────────────

CONTAINER_NAME="emdash-ws-$(date +%s)-$$"

# Forward API keys if set in the host environment.
# Add more -e flags here for other keys your agent needs.
docker run -d \
  --name "$CONTAINER_NAME" \
  --label "emdash.purpose=byoi-workspace" \
  -p "0:22" \
  -v "$(pwd):/repo-source:ro" \
  ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
  ${OPENAI_API_KEY:+-e OPENAI_API_KEY="$OPENAI_API_KEY"} \
  ${GH_TOKEN:+-e GH_TOKEN="$GH_TOKEN"} \
  ${GITHUB_TOKEN:+-e GITHUB_TOKEN="$GITHUB_TOKEN"} \
  ${GEMINI_API_KEY:+-e GEMINI_API_KEY="$GEMINI_API_KEY"} \
  "$IMAGE_NAME" >&2

# ── Wait for sshd ─────────────────────────────────────────────────────────────

echo "Waiting for sshd to start..." >&2
for i in $(seq 1 20); do
  if docker exec "$CONTAINER_NAME" bash -c "pgrep sshd > /dev/null 2>&1" 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "ERROR: sshd did not start within 20 seconds" >&2
    docker logs "$CONTAINER_NAME" >&2
    docker rm -f "$CONTAINER_NAME" >&2
    exit 1
  fi
  sleep 1
done

# ── Clone the repo into the container ─────────────────────────────────────────

echo "Cloning repository into container..." >&2
docker exec "$CONTAINER_NAME" bash -c \
  "git clone /repo-source $WORKSPACE_PATH" >&2

# ── Get assigned SSH port ─────────────────────────────────────────────────────

HOST_PORT=$(docker port "$CONTAINER_NAME" 22/tcp | cut -d: -f2)

# ── Output provision JSON ─────────────────────────────────────────────────────

jq -n \
  --arg id "$CONTAINER_NAME" \
  --arg host "localhost" \
  --argjson port "$HOST_PORT" \
  --arg username "$CONTAINER_USER" \
  --arg password "$CONTAINER_PASS" \
  --arg worktreePath "$WORKSPACE_PATH" \
  '{id: $id, host: $host, port: $port, username: $username, password: $password, worktreePath: $worktreePath}'

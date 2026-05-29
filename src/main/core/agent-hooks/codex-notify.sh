#!/bin/sh
set -u

if [ -z "${EMDASH_HOOK_PORT:-}" ] || [ -z "${EMDASH_HOOK_TOKEN:-}" ] || [ -z "${EMDASH_PTY_ID:-}" ]; then
  exit 0
fi

input="${1:-$(cat)}"
event=$(printf '%s' "$input" | grep -oE '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"')
if [ -z "$event" ]; then
  codex_type=$(printf '%s' "$input" | grep -oE '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"')
  case "$codex_type" in
    agent-turn-complete|task_complete) event="Stop" ;;
    exec_approval_request|apply_patch_approval_request|request_user_input) event="PermissionRequest" ;;
  esac
fi
if [ -z "$event" ]; then
  event="${EMDASH_HOOK_EVENT:-}"
fi

post_hook() {
  event_type="$1"
  curl -sf -X POST \
    -H "Content-Type: application/json" \
    -H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" \
    -H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" \
    -H "X-Emdash-Agent-Id: ${EMDASH_AGENT_ID:-}" \
    -H "X-Emdash-Event-Type: $event_type" \
    -d @- \
    "http://127.0.0.1:$EMDASH_HOOK_PORT/hook" >/dev/null || true
}

case "$event" in
  Stop)
    printf '%s' '{"notification_type":"idle_prompt"}' | post_hook notification
    ;;
  PermissionRequest)
    printf '%s' '{"notification_type":"permission_prompt"}' | post_hook notification
    ;;
  SessionStart)
    printf '%s' "$input" | grep -qE '"hook_event_name"[[:space:]]*:[[:space:]]*"SessionStart"' || exit 0
    printf '%s' "$input" | post_hook session-start
    ;;
esac

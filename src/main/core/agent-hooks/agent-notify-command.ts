import openCodePluginContent from './opencode-notifications-plugin.js?raw';

export function makeClaudeHookCommand(eventType: string): string {
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    `-H "X-Emdash-Event-Type: ${eventType}" ` +
    '-d @- ' +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
  );
}

export function makeOpenCodePluginContent(): string {
  return openCodePluginContent;
}

export function makeCodexHookCommand(
  notificationType: 'idle_prompt' | 'permission_prompt'
): string {
  const payload = JSON.stringify({ notification_type: notificationType });
  return (
    '[ -n "$EMDASH_HOOK_PORT" ] && ' +
    '[ -n "$EMDASH_HOOK_TOKEN" ] && ' +
    '[ -n "$EMDASH_PTY_ID" ] || exit 0; ' +
    'cat >/dev/null; ' +
    `printf %s '${payload}' | ` +
    'curl -sf -X POST ' +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    '-H "X-Emdash-Event-Type: notification" ' +
    '--data-binary @- || true'
  );
}

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

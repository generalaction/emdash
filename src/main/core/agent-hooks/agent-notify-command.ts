import { Buffer } from 'node:buffer';
import ampPluginContent from './amp-emdash-plugin.ts?raw';
import openCodePluginContent from './opencode-notifications-plugin.js?raw';

type HookPostPayload = 'stdin' | { json: Record<string, string> };

type HookPostCommandOptions = {
  eventType: string;
  payload: HookPostPayload;
  platform?: NodeJS.Platform;
};

type HookCommandOptions = {
  platform?: NodeJS.Platform;
};

function makePosixHookPostCommand({ eventType, payload }: HookPostCommandOptions): string {
  const payloadCommand =
    payload === 'stdin' ? '-d @- ' : `--data-binary '${JSON.stringify(payload.json)}' `;
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    `-H "X-Emdash-Event-Type: ${eventType}" ` +
    payloadCommand +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
  );
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function makeWindowsHookPostCommand({ eventType, payload }: HookPostCommandOptions): string {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'if (-not $env:EMDASH_HOOK_PORT -or -not $env:EMDASH_HOOK_TOKEN -or -not $env:EMDASH_PTY_ID) { exit 0 }',
    payload === 'stdin'
      ? '$payload = [Console]::In.ReadToEnd()'
      : `$payload = ${quotePowerShellString(JSON.stringify(payload.json))}`,
    'try { Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Emdash-Token' = $env:EMDASH_HOOK_TOKEN; " +
      "'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID; " +
      `'X-Emdash-Event-Type' = '${eventType}' ` +
      '} -Body $payload | Out-Null } catch { exit 0 }',
  ].join('; ');
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');

  return `cmd.exe /d /c "echo EMDASH_HOOK_PORT >NUL & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}"`;
}

function makeHookPostCommand(options: HookPostCommandOptions): string {
  return (options.platform ?? process.platform) === 'win32'
    ? makeWindowsHookPostCommand(options)
    : makePosixHookPostCommand(options);
}

export function makeClaudeHookCommand(eventType: string, options: HookCommandOptions = {}): string {
  return makeHookPostCommand({ eventType, payload: 'stdin', platform: options.platform });
}

export function makeOpenCodePluginContent(): string {
  return openCodePluginContent;
}

export function makeAmpPluginContent(): string {
  return ampPluginContent;
}

export function makeCodexNotifyScriptContent(): string {
  return `#!/bin/sh
set -u

if [ -z "\${EMDASH_HOOK_PORT:-}" ] || [ -z "\${EMDASH_HOOK_TOKEN:-}" ] || [ -z "\${EMDASH_PTY_ID:-}" ]; then
  exit 0
fi

input="\${1:-$(cat)}"
event=$(printf '%s' "$input" | grep -oE '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"')
if [ -z "$event" ]; then
  codex_type=$(printf '%s' "$input" | grep -oE '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"')
  case "$codex_type" in
    agent-turn-complete|task_complete) event="Stop" ;;
    exec_approval_request|apply_patch_approval_request|request_user_input) event="PermissionRequest" ;;
  esac
fi

case "$event" in
  Stop)
    payload="{\"notification_type\":\"idle_prompt\"}"
    printf '%s' "$payload" | curl -sf -X POST \\
      -H "Content-Type: application/json" \\
      -H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" \\
      -H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" \\
      -H "X-Emdash-Agent-Id: \${EMDASH_AGENT_ID:-}" \\
      -H "X-Emdash-Event-Type: notification" \\
      -d @- \\
      "http://127.0.0.1:$EMDASH_HOOK_PORT/hook" >/dev/null || true
    ;;
  PermissionRequest)
    payload="{\"notification_type\":\"permission_prompt\"}"
    printf '%s' "$payload" | curl -sf -X POST \\
      -H "Content-Type: application/json" \\
      -H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" \\
      -H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" \\
      -H "X-Emdash-Agent-Id: \${EMDASH_AGENT_ID:-}" \\
      -H "X-Emdash-Event-Type: notification" \\
      -d @- \\
      "http://127.0.0.1:$EMDASH_HOOK_PORT/hook" >/dev/null || true
    ;;
  SessionStart)
    printf '%s' "$input" | curl -sf -X POST \\
      -H "Content-Type: application/json" \\
      -H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" \\
      -H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" \\
      -H "X-Emdash-Agent-Id: \${EMDASH_AGENT_ID:-}" \\
      -H "X-Emdash-Event-Type: session-start" \\
      -d @- \\
      "http://127.0.0.1:$EMDASH_HOOK_PORT/hook" >/dev/null || true
    ;;
esac
`;
}

export function makeCodexNotifyPowerShellContent(): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '',
    'if (-not $env:EMDASH_HOOK_PORT -or -not $env:EMDASH_HOOK_TOKEN -or -not $env:EMDASH_PTY_ID) {',
    '  exit 0',
    '}',
    '',
    'if ($args.Count -gt 0) {',
    '  $inputPayload = $args[0]',
    '} else {',
    '  $inputPayload = [Console]::In.ReadToEnd()',
    '}',
    '',
    '$event = $null',
    'try {',
    '  $body = $inputPayload | ConvertFrom-Json',
    '  if ($body.hook_event_name) {',
    '    $event = [string]$body.hook_event_name',
    '  } elseif ($body.type) {',
    '    switch ([string]$body.type) {',
    "      'agent-turn-complete' { $event = 'Stop' }",
    "      'task_complete' { $event = 'Stop' }",
    "      'exec_approval_request' { $event = 'PermissionRequest' }",
    "      'apply_patch_approval_request' { $event = 'PermissionRequest' }",
    "      'request_user_input' { $event = 'PermissionRequest' }",
    '    }',
    '  }',
    '} catch {',
    '  exit 0',
    '}',
    '',
    'switch ($event) {',
    "  'Stop' {",
    "    $payload = @{ notification_type = 'idle_prompt' } | ConvertTo-Json -Compress",
    "    $eventType = 'notification'",
    '  }',
    "  'PermissionRequest' {",
    "    $payload = @{ notification_type = 'permission_prompt' } | ConvertTo-Json -Compress",
    "    $eventType = 'notification'",
    '  }',
    "  'SessionStart' {",
    '    $payload = $inputPayload',
    "    $eventType = 'session-start'",
    '  }',
    '  default {',
    '    exit 0',
    '  }',
    '}',
    '',
    'try {',
    '  Invoke-WebRequest -UseBasicParsing -Method POST `',
    "    -Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') `",
    '    -Headers @{',
    "      'Content-Type' = 'application/json'",
    "      'X-Emdash-Token' = $env:EMDASH_HOOK_TOKEN",
    "      'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID",
    "      'X-Emdash-Agent-Id' = $env:EMDASH_AGENT_ID",
    "      'X-Emdash-Event-Type' = $eventType",
    '    } `',
    '    -Body $payload | Out-Null',
    '} catch {',
    '  exit 0',
    '}',
    '',
  ].join('\n');
}

export function makeCodexNotifyHookCommand(
  scriptPath: string,
  options: HookCommandOptions = {}
): string {
  if ((options.platform ?? process.platform) === 'win32') {
    return `cmd.exe /d /c "set EMDASH_AGENT_ID=codex&& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""${scriptPath}"""`;
  }

  return `EMDASH_AGENT_ID=codex sh "${scriptPath}"`;
}

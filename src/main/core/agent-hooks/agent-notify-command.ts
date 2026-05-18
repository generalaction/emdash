import { Buffer } from 'node:buffer';
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

export function makeCodexHookCommand(
  notificationType: 'idle_prompt' | 'permission_prompt',
  options: HookCommandOptions = {}
): string {
  return makeHookPostCommand({
    eventType: 'notification',
    payload: { json: { notification_type: notificationType } },
    platform: options.platform,
  });
}

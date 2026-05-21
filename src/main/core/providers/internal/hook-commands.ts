import { Buffer } from 'node:buffer';

const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

type HookPostPayload = 'stdin' | { json: Record<string, string> };

function makePosixHookPostCommand(eventType: string, payload: HookPostPayload): string {
  const payloadArg =
    payload === 'stdin' ? '-d @- ' : `--data-binary '${JSON.stringify(payload.json)}' `;
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    `-H "X-Emdash-Event-Type: ${eventType}" ` +
    payloadArg +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
  );
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function makeWindowsHookPostCommand(eventType: string, payload: HookPostPayload): string {
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

/** Build a hook POST command that reads the payload from stdin (used by Claude and Droid). */
export function makeStdinHookCommand(eventType: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? makeWindowsHookPostCommand(eventType, 'stdin')
    : makePosixHookPostCommand(eventType, 'stdin');
}

/** Build a hook POST command that sends a fixed JSON payload (used by Codex). */
export function makeJsonHookCommand(
  eventType: string,
  json: Record<string, string>,
  platform: NodeJS.Platform
): string {
  return platform === 'win32'
    ? makeWindowsHookPostCommand(eventType, { json })
    : makePosixHookPostCommand(eventType, { json });
}

/** Replace emdash-managed entries (identified by EMDASH_HOOK_PORT marker) in a hook list. */
export function mergeHookEntries(existing: unknown[], command: string): unknown[] {
  const userEntries = existing.filter((entry) => !JSON.stringify(entry).includes(EMDASH_MARKER));
  return [...userEntries, { hooks: [{ type: 'command', command }] }];
}

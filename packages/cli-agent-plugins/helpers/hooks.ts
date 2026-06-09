import { Buffer } from 'node:buffer';

export type HookCommandOptions = {
  platform?: NodeJS.Platform;
};

export const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

/** Filter out emdash-managed entries from a hook array. */
export function filterUserHooks<T>(entries: T[], stringify?: (entry: T) => string): T[] {
  const toStr = stringify ?? JSON.stringify;
  return entries.filter((entry) => !toStr(entry).includes(EMDASH_MARKER));
}

// ── Internal helpers ────────────────────────────────────────────────────────

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

type HookPostPayload = 'stdin' | { json: Record<string, string> };

function makePosixHookPostCommand(eventType: string, payload: HookPostPayload): string {
  const payloadPart =
    payload === 'stdin' ? '-d @- ' : `--data-binary '${JSON.stringify(payload.json)}' `;
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    `-H "X-Emdash-Event-Type: ${eventType}" ` +
    payloadPart +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
  );
}

function makeWindowsHookPostCommand(eventType: string, payload: HookPostPayload): string {
  const bodyLine =
    payload === 'stdin'
      ? '$payload = [Console]::In.ReadToEnd()'
      : `$payload = ${quotePowerShellString(JSON.stringify((payload as { json: Record<string, string> }).json))}`;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'if (-not $env:EMDASH_HOOK_PORT -or -not $env:EMDASH_HOOK_TOKEN -or -not $env:EMDASH_PTY_ID) { exit 0 }',
    bodyLine,
    'try { Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Emdash-Token' = $env:EMDASH_HOOK_TOKEN; " +
      "'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID; " +
      `'X-Emdash-Event-Type' = '${eventType}' ` +
      '} -Body $payload | Out-Null } catch { exit 0 }',
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `cmd.exe /d /c "echo EMDASH_HOOK_PORT >NUL & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}"`;
}

function makeHookPostCommand(
  eventType: string,
  payload: HookPostPayload,
  opts: HookCommandOptions
): string {
  return (opts.platform ?? process.platform) === 'win32'
    ? makeWindowsHookPostCommand(eventType, payload)
    : makePosixHookPostCommand(eventType, payload);
}

// ── Public command builders ─────────────────────────────────────────────────

/** Standard stdin-piped hook command (used by Claude, Grok events, Copilot stop, etc.) */
export function makeClaudeHookCommand(eventType: string, opts: HookCommandOptions = {}): string {
  return makeHookPostCommand(eventType, 'stdin', opts);
}

/**
 * Codex-style hook command with a fixed notification_type JSON body.
 * Used for idle_prompt and permission_prompt events.
 */
export function makeCodexHookCommand(
  notificationType: 'idle_prompt' | 'permission_prompt',
  opts: HookCommandOptions = {}
): string {
  return makeHookPostCommand(
    'notification',
    { json: { notification_type: notificationType } },
    opts
  );
}

/**
 * Codex session-start hook command.
 * On POSIX: wraps with `INPUT="${1:-$(cat)}"; printf '%s' "$INPUT" | <post>`.
 */
export function makeCodexSessionStartHookCommand(opts: HookCommandOptions = {}): string {
  const post = makeHookPostCommand('session-start', 'stdin', opts);
  if ((opts.platform ?? process.platform) === 'win32') return post;
  return `INPUT="\${1:-$(cat)}"; printf '%s' "$INPUT" | ${post}`;
}

/**
 * Grok session-start hook command.
 * POSIX: inlines $GROK_SESSION_ID as a JSON string.
 * Windows: reads $env:GROK_SESSION_ID and converts to JSON.
 */
export function makeGrokSessionStartHookCommand(opts: HookCommandOptions = {}): string {
  if ((opts.platform ?? process.platform) === 'win32') {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      'if (-not $env:EMDASH_HOOK_PORT -or -not $env:EMDASH_HOOK_TOKEN -or -not $env:EMDASH_PTY_ID) { exit 0 }',
      '$payload = @{ session_id = $env:GROK_SESSION_ID } | ConvertTo-Json -Compress',
      'try { Invoke-WebRequest -UseBasicParsing -Method POST ' +
        "-Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') " +
        '-Headers @{ ' +
        "'Content-Type' = 'application/json'; " +
        "'X-Emdash-Token' = $env:EMDASH_HOOK_TOKEN; " +
        "'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID; " +
        "'X-Emdash-Event-Type' = 'session' " +
        '} -Body $payload | Out-Null } catch { exit 0 }',
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return `cmd.exe /d /c "echo EMDASH_HOOK_PORT >NUL & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}"`;
  }
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    '-H "X-Emdash-Event-Type: session" ' +
    `--data-binary '{"session_id":"'"$GROK_SESSION_ID"'"}' ` +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
  );
}

/** Standard emdash hook command (stdin-piped, POSIX). Legacy export name. */
export function buildEmdashHookCommand(opts: { platform: NodeJS.Platform; eventType: string }): string {
  return makeClaudeHookCommand(opts.eventType, { platform: opts.platform });
}

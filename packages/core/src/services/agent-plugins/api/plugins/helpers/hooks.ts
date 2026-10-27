import { Buffer } from 'node:buffer';
import { quoteArg } from '#primitives/exec/api';

export type HookCommandOptions = {
  platform?: NodeJS.Platform;
  stdoutJson?: Record<string, unknown>;
};

export const AGENT_MARKER = 'AGENT_HOOK_PORT';
export const AGENT_HOOK_CONFIG_VERSION = 1;
export const AGENT_HOOK_VERSION_MARKER = `AGENT_HOOK_CONFIG_VERSION=${AGENT_HOOK_CONFIG_VERSION}`;
export const AGENT_HOOK_POSIX_GUARD =
  'if [ -z "${AGENT_HOOK_PORT:-}" ] || [ -z "${AGENT_HOOK_NONCE:-}" ] || [ -z "${AGENT_PTY_ID:-}" ]; then exit 0; fi';

/** Filter out agent-managed entries from a hook array. */
export function filterUserHooks<T>(entries: T[], stringify?: (entry: T) => string): T[] {
  const toStr = stringify ?? JSON.stringify;
  return entries.filter((entry) => !toStr(entry).includes(AGENT_MARKER));
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
    `${AGENT_HOOK_VERSION_MARKER}; ${AGENT_HOOK_POSIX_GUARD}; curl -sf -X POST ` +
    '-H "Content-Type: application/json" ' +
    '-H "X-Agent-Token: $AGENT_HOOK_NONCE" ' +
    '-H "X-Agent-Pty-Id: $AGENT_PTY_ID" ' +
    `-H "X-Agent-Event-Type: ${eventType}" ` +
    payloadPart +
    '"http://127.0.0.1:$AGENT_HOOK_PORT/hook" || true'
  );
}

function makeWindowsHookPostCommand(
  eventType: string,
  payload: HookPostPayload,
  stdoutJson?: Record<string, unknown>
): string {
  const bodyLine =
    payload === 'stdin'
      ? '$payload = [Console]::In.ReadToEnd()'
      : `$payload = ${quotePowerShellString(JSON.stringify((payload as { json: Record<string, string> }).json))}`;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'if (-not $env:AGENT_HOOK_PORT -or -not $env:AGENT_HOOK_NONCE -or -not $env:AGENT_PTY_ID) { exit 0 }',
    bodyLine,
    'try { Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:AGENT_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Agent-Token' = $env:AGENT_HOOK_NONCE; " +
      "'X-Agent-Pty-Id' = $env:AGENT_PTY_ID; " +
      `'X-Agent-Event-Type' = '${eventType}' ` +
      '} -Body $payload | Out-Null } catch { exit 0 }',
  ].join('; ');
  return makeWindowsPowerShellHookCommand(
    stdoutJson === undefined
      ? script
      : `try { ${script} } finally { [Console]::Out.WriteLine(${quotePowerShellString(JSON.stringify(stdoutJson))}) }`
  );
}

export function makeWindowsPowerShellHookCommand(script: string): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  // A silent `set` no-op embeds both markers so hook-config cleanup can find
  // our entries. No `>NUL`: an outer shell (Git Bash/PowerShell) parses the
  // redirect before cmd.exe and creates a real `NUL` file. No quotes either —
  // they break when the body is re-wrapped in `cmd.exe /c`. Markers go in the
  // value, not the var name, so they can't shadow AGENT_HOOK_PORT/NONCE/PTY_ID.
  return (
    `cmd.exe /d /c set AGENT_HOOK_MARKER=${AGENT_HOOK_VERSION_MARKER} ${AGENT_MARKER}&&` +
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`
  );
}

/** Post an event with an arbitrary payload, platform-aware. */
export function makeHookPostCommand(
  eventType: string,
  payload: HookPostPayload,
  opts: HookCommandOptions
): string {
  if ((opts.platform ?? process.platform) === 'win32') {
    return makeWindowsHookPostCommand(eventType, payload, opts.stdoutJson);
  }
  const command = makePosixHookPostCommand(eventType, payload);
  return opts.stdoutJson === undefined
    ? command
    : `( ${command} ) >/dev/null; printf '%s\\n' ${quoteArg(JSON.stringify(opts.stdoutJson), 'posix')}`;
}

// ── Public command builders ─────────────────────────────────────────────────

/**
 * Standard stdin-piped hook command.
 * The agent pipes the event JSON body through stdin.
 */
export function makeStdinHookCommand(eventType: string, opts: HookCommandOptions = {}): string {
  return makeHookPostCommand(eventType, 'stdin', opts);
}

/**
 * Fixed-body notification hook command.
 * Sends a JSON body with a `notification_type` key (used by Codex-style events).
 */
export function makeNotificationHookCommand(
  notificationType: 'idle_prompt' | 'permission_prompt',
  opts: HookCommandOptions = {}
): string {
  return makeHookPostCommand(
    'notification',
    { json: { notification_type: notificationType } },
    opts
  );
}

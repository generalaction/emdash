import { Buffer } from 'node:buffer';
import { loopbackCurlCommand, quoteArg } from '#primitives/exec/api';

export type HookCommandOptions = {
  platform?: NodeJS.Platform;
  stdoutJson?: Record<string, unknown>;
};

export const EMDASH_MARKER = 'EMDASH_HOOK_PORT';
export const EMDASH_HOOK_CONFIG_VERSION = 1;
export const EMDASH_HOOK_VERSION_MARKER = `EMDASH_HOOK_CONFIG_VERSION=${EMDASH_HOOK_CONFIG_VERSION}`;
export const EMDASH_HOOK_POSIX_GUARD =
  'if [ -z "${EMDASH_HOOK_PORT:-}" ] || [ -z "${EMDASH_HOOK_NONCE:-}" ] || [ -z "${EMDASH_PTY_ID:-}" ]; then exit 0; fi';

const WINDOWS_ENCODED_COMMAND = /-EncodedCommand ([A-Za-z0-9+/]+={0,2})/g;

/**
 * Whether serialized hook config carries the Emdash marker, either in plain text (POSIX and
 * legacy Windows commands) or inside a Windows encoded command, whose script is opaque base64.
 */
function hasEmdashMarker(serialized: string): boolean {
  if (serialized.includes(EMDASH_MARKER)) return true;
  return [...serialized.matchAll(WINDOWS_ENCODED_COMMAND)].some(([, encoded]) =>
    Buffer.from(encoded, 'base64').toString('utf16le').includes(EMDASH_MARKER)
  );
}

/** Filter out emdash-managed entries from a hook array. */
export function filterUserHooks<T>(entries: T[], stringify?: (entry: T) => string): T[] {
  const toStr = stringify ?? JSON.stringify;
  return entries.filter((entry) => !hasEmdashMarker(toStr(entry)));
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
    `${EMDASH_HOOK_VERSION_MARKER}; ${EMDASH_HOOK_POSIX_GUARD}; ` +
    `${makePosixHookCurl(eventType, payloadPart)} || true`
  );
}

/**
 * The hook POST itself, for a payload given as curl data arguments; the nonce stays off
 * argv (see {@link loopbackCurlCommand}).
 */
export function makePosixHookCurl(eventType: string, payloadArgs: string): string {
  return loopbackCurlCommand(
    'EMDASH_HOOK_NONCE',
    '-sf -X POST ' +
      '-H "Content-Type: application/json" ' +
      '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
      `-H "X-Emdash-Event-Type: ${eventType}" ` +
      payloadArgs +
      '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook"',
    'posix'
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
    'if (-not $env:EMDASH_HOOK_PORT -or -not $env:EMDASH_HOOK_NONCE -or -not $env:EMDASH_PTY_ID) { exit 0 }',
    bodyLine,
    'try { Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Emdash-Token' = $env:EMDASH_HOOK_NONCE; " +
      "'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID; " +
      `'X-Emdash-Event-Type' = '${eventType}' ` +
      '} -Body $payload | Out-Null } catch { exit 0 }',
  ].join('; ');
  return makeWindowsPowerShellHookCommand(
    stdoutJson === undefined
      ? script
      : `try { ${script} } finally { [Console]::Out.WriteLine(${quotePowerShellString(JSON.stringify(stdoutJson))}) }`
  );
}

/**
 * Agents hand a hook command to whichever shell they use on Windows: Git Bash, cmd.exe or
 * PowerShell. A lone `powershell.exe` call whose arguments are `-` switches and base64 means
 * the same in all three, and its stdin (the hook payload) reaches the script untouched.
 *
 * Nothing may wrap it: Git Bash rewrites `/`-style switches into drive paths, so a
 * `cmd.exe /d /c` wrapper loses `/c`, starts interactively and runs the payload as commands.
 * Redirects and quotes are parsed differently by each outer shell, too. The markers ride in a
 * leading comment instead, where {@link filterUserHooks} decodes them; it also keeps the base64
 * from starting with `/`.
 */
export function makeWindowsPowerShellHookCommand(script: string): string {
  const markedScript = `# ${EMDASH_HOOK_VERSION_MARKER} ${EMDASH_MARKER}\n${script}`;
  const encoded = Buffer.from(markedScript, 'utf16le').toString('base64');
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
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

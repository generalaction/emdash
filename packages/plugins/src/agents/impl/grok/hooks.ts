import type { PluginFs } from '@agent/core/services/agent-plugins/api/plugins';
import type {
  CanonicalHookEvent,
  HookRegistration,
} from '@agent/core/services/agent-plugins/api/plugins';
import {
  AGENT_MARKER,
  AGENT_HOOK_POSIX_GUARD,
  AGENT_HOOK_VERSION_MARKER,
  buildNestedEntry,
  configRoots,
  defaultHookEventParser,
  filterUserHooks,
  homeConfigRoot,
  hookMapFromConfig,
  makeWindowsPowerShellHookCommand,
  makeStdinHookCommand,
  readJsonConfig,
  writeJsonConfig,
} from '@agent/core/services/agent-plugins/api/plugins/helpers';

export const GROK_HOOKS_PATH = 'hooks/agent.json';

function makeGrokSessionStartCommand(): string {
  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      'if (-not $env:AGENT_HOOK_PORT -or -not $env:AGENT_HOOK_NONCE -or -not $env:AGENT_PTY_ID) { exit 0 }',
      '$payload = @{ session_id = $env:GROK_SESSION_ID } | ConvertTo-Json -Compress',
      'try { Invoke-WebRequest -UseBasicParsing -Method POST ' +
        "-Uri ('http://127.0.0.1:' + $env:AGENT_HOOK_PORT + '/hook') " +
        '-Headers @{ ' +
        "'Content-Type' = 'application/json'; " +
        "'X-Agent-Token' = $env:AGENT_HOOK_NONCE; " +
        "'X-Agent-Pty-Id' = $env:AGENT_PTY_ID; " +
        "'X-Agent-Event-Type' = 'session' " +
        '} -Body $payload | Out-Null } catch { exit 0 }',
    ].join('; ');
    return makeWindowsPowerShellHookCommand(script);
  }
  return (
    `${AGENT_HOOK_VERSION_MARKER}; ${AGENT_HOOK_POSIX_GUARD}; curl -sf -X POST ` +
    '-H "Content-Type: application/json" ' +
    '-H "X-Agent-Token: $AGENT_HOOK_NONCE" ' +
    '-H "X-Agent-Pty-Id: $AGENT_PTY_ID" ' +
    '-H "X-Agent-Event-Type: session" ' +
    `--data-binary '{"session_id":"'"$GROK_SESSION_ID"'"}' ` +
    '"http://127.0.0.1:$AGENT_HOOK_PORT/hook" || true'
  );
}

const hookEntries = () => [
  { hookKey: 'SessionStart', command: makeGrokSessionStartCommand() },
  { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
  { hookKey: 'PreToolUse', command: makeStdinHookCommand('start') },
  { hookKey: 'PostToolUse', command: makeStdinHookCommand('start') },
  { hookKey: 'PostToolUseFailure', command: makeStdinHookCommand('start') },
  { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
  { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  { hookKey: 'StopFailure', command: makeStdinHookCommand('stop') },
  { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
];

/**
 * Grok sends Notification events without a notification_type field.
 * All Grok notifications are permission-style prompts.
 */
function parseGrokHookEvent(eventType: string, body: Record<string, unknown>): CanonicalHookEvent {
  if (eventType === 'notification') {
    return {
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      message: typeof body.message === 'string' ? body.message : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
    };
  }
  return defaultHookEventParser(eventType, body);
}

export function buildGrokHookConfig() {
  const specs = hookEntries();
  return {
    resolveConfigRoots: configRoots(homeConfigRoot('.grok')),
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, GROK_HOOKS_PATH);
      const hooks = hookMapFromConfig(config, GROK_HOOKS_PATH);
      const installed = specs.every(({ hookKey, command }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some(
          (entry) => JSON.stringify(entry) === JSON.stringify(buildNestedEntry(command))
        );
      });
      return installed ? [{ event: 'agent', command: AGENT_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, GROK_HOOKS_PATH);
      const hooks = hookMapFromConfig(config, GROK_HOOKS_PATH);
      for (const { hookKey, command } of specs) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = [...filterUserHooks(existing), buildNestedEntry(command)];
      }
      await writeJsonConfig(fs, GROK_HOOKS_PATH, { ...config, hooks });
      return [GROK_HOOKS_PATH];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, GROK_HOOKS_PATH);
      const hooks = hookMapFromConfig(config, GROK_HOOKS_PATH);
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key]);
      }
      await writeJsonConfig(fs, GROK_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, GROK_HOOKS_PATH);
      const hooks = hookMapFromConfig(config, GROK_HOOKS_PATH);
      return specs.every(({ hookKey, command }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some(
          (entry) => JSON.stringify(entry) === JSON.stringify(buildNestedEntry(command))
        );
      });
    },
    parseHookEvent: parseGrokHookEvent,
  };
}

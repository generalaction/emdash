import type { PluginFs } from '@emdash/core/agents/plugins';
import type { CanonicalHookEvent, HookRegistration } from '@emdash/core/agents/plugins';
import {
  EMDASH_MARKER,
  buildNestedEntry,
  defaultHookEventParser,
  filterUserHooks,
  makeHookPostCommand,
  makeNotificationHookCommand,
  readJsonConfig,
  readTomlConfig,
  writeJsonConfig,
  writeTomlConfig,
} from '@emdash/core/agents/plugins/helpers';
import * as toml from 'smol-toml';

export const CODEX_CONFIG_PATH = '.codex/config.toml';
export const CODEX_LEGACY_HOOKS_PATH = '.codex/hooks.json';

const LEGACY_CODEX_NOTIFY_COMMAND = [
  'bash',
  '-c',
  'curl -sf -X POST ' +
    "-H 'Content-Type: application/json' " +
    '-H "X-Emdash-Token: $EMDASH_HOOK_NONCE" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    '-H "X-Emdash-Event-Type: notification" ' +
    '-d "$1" ' +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true',
  '_',
];

function isLegacyCodexNotify(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (JSON.stringify(value) === JSON.stringify(LEGACY_CODEX_NOTIFY_COMMAND)) return true;
  const [command, noProfile, fileFlag, scriptPath] = value.map((item) => String(item));
  return (
    command.toLowerCase() === 'powershell.exe' &&
    noProfile === '-NoProfile' &&
    fileFlag === '-File' &&
    typeof scriptPath === 'string' &&
    scriptPath.endsWith('emdash-codex-notify.ps1')
  );
}

async function removeLegacyCodexNotify(fs: PluginFs): Promise<void> {
  const raw = await fs.read(CODEX_CONFIG_PATH);
  if (!raw) return;

  let config: Record<string, unknown>;
  try {
    config = toml.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  if (!isLegacyCodexNotify(config.notify)) return;

  delete config.notify;
  await fs.write(CODEX_CONFIG_PATH, toml.stringify(config));
}

function getHooks(config: Record<string, unknown>): Record<string, unknown[]> {
  return (config.hooks ?? {}) as Record<string, unknown[]>;
}

function hasCodexEmdashHooks(hooks: Record<string, unknown[]>): boolean {
  return ['Stop', 'PermissionRequest', 'SessionStart'].some((k) => {
    const entries = Array.isArray(hooks[k]) ? hooks[k] : [];
    return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
  });
}

async function readLegacyHooks(fs: PluginFs): Promise<Record<string, unknown[]>> {
  const config = await readJsonConfig(fs, CODEX_LEGACY_HOOKS_PATH);
  return getHooks(config);
}

async function migrateLegacyHooks(
  fs: PluginFs,
  hooks: Record<string, unknown[]>
): Promise<() => Promise<void>> {
  const legacyHooks = await readLegacyHooks(fs);

  for (const [key, entries] of Object.entries(legacyHooks)) {
    if (!Array.isArray(entries)) continue;

    const userEntries = filterUserHooks(entries as Record<string, unknown>[]);
    if (!userEntries.length) continue;

    const existing = Array.isArray(hooks[key]) ? hooks[key] : [];
    hooks[key] = [...filterUserHooks(existing as Record<string, unknown>[]), ...userEntries];
  }

  return async () => {
    await fs.delete(CODEX_LEGACY_HOOKS_PATH).catch(() => {});
  };
}

function makeCodexSessionStartCommand(): string {
  const post = makeHookPostCommand('session-start', 'stdin', {});
  if (process.platform === 'win32') return post;
  return `INPUT="\${1:-$(cat)}"; printf '%s' "$INPUT" | ${post}`;
}

/**
 * Codex sends `{ type: 'agent-turn-complete' }` as its stop signal instead
 * of a plain 'stop' event type, and uses fixed `notification_type` values
 * in its hook payloads rather than piping JSON.
 */
function parseCodexHookEvent(eventType: string, body: Record<string, unknown>): CanonicalHookEvent {
  if (eventType === 'session-start') {
    const candidates = [body.session_id, body.resource_id, body.resourceId, body.sessionId];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return { kind: 'session', providerSessionId: candidate.trim() };
      }
    }
    return { kind: 'ignore' };
  }

  if (eventType === 'notification') {
    const nt = body.notification_type;
    if (nt === 'idle_prompt' || (typeof nt !== 'string' && body.type === 'agent-turn-complete')) {
      return { kind: 'status', type: 'stop' };
    }
    if (nt === 'permission_prompt') {
      return { kind: 'status', type: 'notification', notificationType: 'permission_prompt' };
    }
  }

  return defaultHookEventParser(eventType, body);
}

export function buildCodexHookConfig() {
  const stopCmd = makeNotificationHookCommand('idle_prompt');
  const permCmd = makeNotificationHookCommand('permission_prompt');
  const sessionCmd = makeCodexSessionStartCommand();

  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readTomlConfig(fs, CODEX_CONFIG_PATH);
      if (hasCodexEmdashHooks(getHooks(config))) {
        return [{ event: 'emdash', command: EMDASH_MARKER }];
      }

      return hasCodexEmdashHooks(await readLegacyHooks(fs))
        ? [{ event: 'emdash', command: EMDASH_MARKER }]
        : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readTomlConfig(fs, CODEX_CONFIG_PATH);
      const hooks = getHooks(config);
      const cleanupLegacy = await migrateLegacyHooks(fs, hooks);

      for (const [key, cmd] of [
        ['Stop', stopCmd],
        ['PermissionRequest', permCmd],
        ['SessionStart', sessionCmd],
      ] as [string, string][]) {
        const existing = Array.isArray(hooks[key]) ? hooks[key] : [];
        hooks[key] = [
          ...filterUserHooks(existing as Record<string, unknown>[]),
          buildNestedEntry(cmd),
        ];
      }
      await writeTomlConfig(fs, CODEX_CONFIG_PATH, { ...config, hooks });
      await cleanupLegacy();
      await removeLegacyCodexNotify(fs).catch(() => {});
      return [CODEX_CONFIG_PATH];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readTomlConfig(fs, CODEX_CONFIG_PATH);
      const hooks = getHooks(config);
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeTomlConfig(fs, CODEX_CONFIG_PATH, { ...config, hooks });

      const legacyConfig = await readJsonConfig(fs, CODEX_LEGACY_HOOKS_PATH);
      const legacyHooks = getHooks(legacyConfig);
      for (const key of Object.keys(legacyHooks)) {
        legacyHooks[key] = filterUserHooks(legacyHooks[key] as Record<string, unknown>[]);
      }
      if (Object.values(legacyHooks).some((entries) => Array.isArray(entries) && entries.length)) {
        await writeJsonConfig(fs, CODEX_LEGACY_HOOKS_PATH, { ...legacyConfig, hooks: legacyHooks });
      } else {
        await fs.delete(CODEX_LEGACY_HOOKS_PATH).catch(() => {});
      }
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readTomlConfig(fs, CODEX_CONFIG_PATH);
      return (
        hasCodexEmdashHooks(getHooks(config)) || hasCodexEmdashHooks(await readLegacyHooks(fs))
      );
    },
    parseHookEvent: parseCodexHookEvent,
  };
}

import * as toml from 'smol-toml';
import { makeJsonHookCommand, mergeHookEntries } from '../internal/hook-commands';
import { createProviderPlugin } from '../types';

const CODEX_HOOKS_PATH = '.codex/hooks.json';
const CODEX_CONFIG_PATH = '.codex/config.toml';

const LEGACY_CODEX_NOTIFY_COMMAND = [
  'bash',
  '-c',
  'curl -sf -X POST ' +
    "-H 'Content-Type: application/json' " +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    '-H "X-Emdash-Event-Type: notification" ' +
    '-d "$1" ' +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true',
  '_',
];

const HOOK_EVENT_MAP = [
  { hookKey: 'Stop', notificationType: 'idle_prompt' },
  { hookKey: 'PermissionRequest', notificationType: 'permission_prompt' },
] as const;

function isLegacyCodexNotify(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (JSON.stringify(value) === JSON.stringify(LEGACY_CODEX_NOTIFY_COMMAND)) return true;

  const [command, noProfile, fileFlag, scriptPath] = value.map((item) => String(item));
  return (
    command.toLowerCase() === 'powershell.exe' &&
    noProfile === '-NoProfile' &&
    fileFlag === '-File' &&
    scriptPath.endsWith('emdash-codex-notify.ps1')
  );
}

export const codexPlugin = createProviderPlugin(
  ({ readProjectFile, writeProjectFile, readUserFile, writeUserFile, platform }) => ({
    supportsHooks: true,

    async writeHookConfig() {
      const raw = await readUserFile(CODEX_HOOKS_PATH);
      const config: Record<string, unknown> = raw
        ? ((JSON.parse(raw) as Record<string, unknown>) ?? {})
        : {};

      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

      for (const { hookKey, notificationType } of HOOK_EVENT_MAP) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeHookEntries(
          existing,
          makeJsonHookCommand('notification', { notification_type: notificationType }, platform)
        );
      }

      await writeUserFile(CODEX_HOOKS_PATH, JSON.stringify({ ...config, hooks }, null, 2) + '\n');

      // Remove legacy notify entry from project-local config.toml
      await removeLegacyCodexNotify(readProjectFile, writeProjectFile);

      return true;
    },
  })
);

async function removeLegacyCodexNotify(
  readProjectFile: (rel: string) => Promise<string | undefined>,
  writeProjectFile: (rel: string, content: string) => Promise<void>
): Promise<void> {
  const raw = await readProjectFile(CODEX_CONFIG_PATH);
  if (!raw) return;

  let config: Record<string, unknown>;
  try {
    config = toml.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  if (!isLegacyCodexNotify(config.notify)) return;

  delete config.notify;
  await writeProjectFile(CODEX_CONFIG_PATH, toml.stringify(config));
}

import type { PluginFs } from '@emdash/shared/agents/plugins';
import type { HookRegistration } from '@emdash/shared/agents/plugins';
import {
  EMDASH_MARKER,
  buildNestedEntry,
  filterUserHooks,
  makeHookPostCommand,
  makeNotificationHookCommand,
  readJsonConfig,
  writeJsonConfig,
} from '@emdash/shared/agents/plugins/helpers';

export const CODEX_HOOKS_PATH = '.codex/hooks.json';

function makeCodexSessionStartCommand(): string {
  const post = makeHookPostCommand('session-start', 'stdin', {});
  if (process.platform === 'win32') return post;
  return `INPUT="\${1:-$(cat)}"; printf '%s' "$INPUT" | ${post}`;
}

export function buildCodexHookConfig() {
  const stopCmd = makeNotificationHookCommand('idle_prompt');
  const permCmd = makeNotificationHookCommand('permission_prompt');
  const sessionCmd = makeCodexSessionStartCommand();

  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, CODEX_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = ['Stop', 'PermissionRequest', 'SessionStart'].some((k) => {
        const entries = Array.isArray(hooks[k]) ? hooks[k] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<void> {
      const config = await readJsonConfig(fs, CODEX_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
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
      await writeJsonConfig(fs, CODEX_HOOKS_PATH, { ...config, hooks });
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, CODEX_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, CODEX_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, CODEX_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return ['Stop', 'PermissionRequest', 'SessionStart'].some((k) => {
        const entries = Array.isArray(hooks[k]) ? hooks[k] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

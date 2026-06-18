import type { HookRegistration, PluginFs } from '@emdash/core/agents/plugins';
import {
  EMDASH_MARKER,
  filterUserHooks,
  makeStdinHookCommand,
  mergeNestedEntries,
  readJsonConfig,
  writeJsonConfig,
} from '@emdash/core/agents/plugins/helpers';

export const DROID_HOOKS_PATH = '.factory/hooks.json';
export const DROID_LEGACY_HOOKS_PATH = '.factory/settings.json';

const DROID_HOOK_SPECS = [
  { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
  { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
];

function hasManagedHooks(config: Record<string, unknown>): boolean {
  const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
  return DROID_HOOK_SPECS.some(({ hookKey }) => {
    const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
    return entries.some((entry) => JSON.stringify(entry).includes(EMDASH_MARKER));
  });
}

function removeManagedHooks(config: Record<string, unknown>): void {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return;
  for (const key of Object.keys(hooks)) {
    const entries = (hooks as Record<string, unknown>)[key];
    if (Array.isArray(entries)) {
      (hooks as Record<string, unknown>)[key] = filterUserHooks(
        entries as Record<string, unknown>[]
      );
    }
  }
}

export function buildDroidHookConfig() {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      for (const path of [DROID_HOOKS_PATH, DROID_LEGACY_HOOKS_PATH]) {
        const config = await readJsonConfig(fs, path);
        if (hasManagedHooks(config)) return [{ event: 'emdash', command: EMDASH_MARKER }];
      }
      return [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, DROID_HOOKS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const { hookKey, command } of DROID_HOOK_SPECS) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeNestedEntries(existing, command);
      }
      await writeJsonConfig(fs, DROID_HOOKS_PATH, { ...config, hooks });

      const writtenPaths = [DROID_HOOKS_PATH];
      const legacyConfig = await readJsonConfig(fs, DROID_LEGACY_HOOKS_PATH);
      if (hasManagedHooks(legacyConfig)) {
        removeManagedHooks(legacyConfig);
        await writeJsonConfig(fs, DROID_LEGACY_HOOKS_PATH, legacyConfig);
        writtenPaths.push(DROID_LEGACY_HOOKS_PATH);
      }

      return writtenPaths;
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      for (const path of [DROID_HOOKS_PATH, DROID_LEGACY_HOOKS_PATH]) {
        const content = await fs.read(path);
        if (!content) continue;
        const config = await readJsonConfig(fs, path);
        removeManagedHooks(config);
        await writeJsonConfig(fs, path, config);
      }
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      for (const path of [DROID_HOOKS_PATH, DROID_LEGACY_HOOKS_PATH]) {
        const config = await readJsonConfig(fs, path);
        if (hasManagedHooks(config)) return true;
      }
      return false;
    },
  };
}

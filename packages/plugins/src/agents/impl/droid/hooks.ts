import type { HookRegistration, PluginFs } from '@emdash/core/agents/plugins';
import {
  buildNestedEntry,
  EMDASH_MARKER,
  filterUserHooks,
  makeStdinHookCommand,
  readJsonConfig,
  writeJsonConfig,
} from '@emdash/core/agents/plugins/helpers';

export const DROID_HOOKS_PATH = '.factory/hooks.json';
const DROID_LEGACY_SETTINGS_PATH = '.factory/settings.json';
const DROID_HOOK_SPECS = [
  { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
  { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
];

function getHooks(config: Record<string, unknown>): Record<string, unknown[]> {
  return (config.hooks ?? {}) as Record<string, unknown[]>;
}

function mergeUniqueUserHooks(
  current: Record<string, unknown[]>,
  fallback: Record<string, unknown[]>
): Record<string, unknown[]> {
  const merged = { ...current };
  for (const key of new Set([...Object.keys(fallback), ...Object.keys(current)])) {
    const currentEntries = Array.isArray(current[key]) ? current[key] : [];
    const fallbackEntries = Array.isArray(fallback[key]) ? fallback[key] : [];
    const entries = filterUserHooks([
      ...(fallbackEntries as Record<string, unknown>[]),
      ...(currentEntries as Record<string, unknown>[]),
    ]);
    const seen = new Set<string>();
    merged[key] = entries.filter((entry) => {
      const serialized = JSON.stringify(entry);
      if (seen.has(serialized)) return false;
      seen.add(serialized);
      return true;
    });
  }
  return merged;
}

function hasAllManagedEntries(hooks: Record<string, unknown[]>): boolean {
  return DROID_HOOK_SPECS.every(({ hookKey, command }) => {
    const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
    const managedEntry = JSON.stringify(buildNestedEntry(command));
    return entries.some((entry) => JSON.stringify(entry) === managedEntry);
  });
}

export function buildDroidHookConfig() {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, DROID_HOOKS_PATH);
      return hasAllManagedEntries(getHooks(config))
        ? [{ event: 'emdash', command: EMDASH_MARKER }]
        : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, DROID_HOOKS_PATH);
      const legacySettings = await readJsonConfig(fs, DROID_LEGACY_SETTINGS_PATH);
      const hooks = mergeUniqueUserHooks(getHooks(config), getHooks(legacySettings));

      for (const { hookKey, command } of DROID_HOOK_SPECS) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = [
          ...filterUserHooks(existing as Record<string, unknown>[]),
          buildNestedEntry(command),
        ];
      }

      await writeJsonConfig(fs, DROID_HOOKS_PATH, { ...config, hooks });
      return [DROID_HOOKS_PATH];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, DROID_HOOKS_PATH);
      const hooks = getHooks(config);
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, DROID_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, DROID_HOOKS_PATH);
      return hasAllManagedEntries(getHooks(config));
    },
  };
}

import type { HookRegistration, PluginFs } from '@emdash/core/agents/plugins';
import {
  EMDASH_MARKER,
  filterUserHooks,
  makeNotificationHookCommand,
  makeStdinHookCommand,
  mergeNestedEntries,
  readJsonConfig,
  writeJsonConfig,
} from '@emdash/core/agents/plugins/helpers';

export const DEVIN_HOOKS_PATH = '.devin/hooks.v1.json';

const DEVIN_HOOK_SPECS = [
  { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
  { hookKey: 'PermissionRequest', command: makeNotificationHookCommand('permission_prompt') },
];

function hasManagedTopLevelHooks(config: Record<string, unknown>): boolean {
  return DEVIN_HOOK_SPECS.some(({ hookKey }) => {
    const entries = Array.isArray(config[hookKey]) ? config[hookKey] : [];
    return entries.some((entry) => JSON.stringify(entry).includes(EMDASH_MARKER));
  });
}

function hasManagedLegacyHooks(config: Record<string, unknown>): boolean {
  const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
  return DEVIN_HOOK_SPECS.some(({ hookKey }) => {
    const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
    return entries.some((entry) => JSON.stringify(entry).includes(EMDASH_MARKER));
  });
}

function removeManagedTopLevelHooks(config: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    if (Array.isArray(config[key])) {
      config[key] = filterUserHooks(config[key] as Record<string, unknown>[]);
    }
  }
}

function removeManagedLegacyHooks(config: Record<string, unknown>): void {
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

export function buildDevinHookConfig() {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, DEVIN_HOOKS_PATH);
      return hasManagedTopLevelHooks(config) || hasManagedLegacyHooks(config)
        ? [{ event: 'emdash', command: EMDASH_MARKER }]
        : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, DEVIN_HOOKS_PATH);
      removeManagedLegacyHooks(config);
      for (const { hookKey, command } of DEVIN_HOOK_SPECS) {
        const existing = Array.isArray(config[hookKey]) ? config[hookKey] : [];
        config[hookKey] = mergeNestedEntries(existing, command);
      }
      await writeJsonConfig(fs, DEVIN_HOOKS_PATH, config);
      return [DEVIN_HOOKS_PATH];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, DEVIN_HOOKS_PATH);
      removeManagedTopLevelHooks(config);
      removeManagedLegacyHooks(config);
      await writeJsonConfig(fs, DEVIN_HOOKS_PATH, config);
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, DEVIN_HOOKS_PATH);
      return hasManagedTopLevelHooks(config) || hasManagedLegacyHooks(config);
    },
  };
}

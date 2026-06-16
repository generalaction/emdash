import type { PluginFs } from '@emdash/shared/agents/plugins';
import type { HookRegistration } from '@emdash/shared/agents/plugins';
import {
  EMDASH_MARKER,
  buildNestedEntry,
  filterUserHooks,
  makeStdinHookCommand,
  readJsonConfig,
  writeJsonConfig,
} from '@emdash/shared/agents/plugins/helpers';

export const COMMANDCODE_SETTINGS_PATH = '.commandcode/settings.json';

const STOP_HOOK_COMMANDS = [makeStdinHookCommand('session'), makeStdinHookCommand('stop')];

export function buildCommandCodeHookConfig() {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, COMMANDCODE_SETTINGS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const stopHooks = Array.isArray(hooks.Stop) ? hooks.Stop : [];
      const installed = stopHooks.some((entry) => JSON.stringify(entry).includes(EMDASH_MARKER));
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, COMMANDCODE_SETTINGS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const existing = Array.isArray(hooks.Stop) ? hooks.Stop : [];
      hooks.Stop = [
        ...filterUserHooks(existing as Record<string, unknown>[]),
        ...STOP_HOOK_COMMANDS.map(buildNestedEntry),
      ];
      await writeJsonConfig(fs, COMMANDCODE_SETTINGS_PATH, { ...config, hooks });
      return [COMMANDCODE_SETTINGS_PATH];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, COMMANDCODE_SETTINGS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, COMMANDCODE_SETTINGS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, COMMANDCODE_SETTINGS_PATH);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const stopHooks = Array.isArray(hooks.Stop) ? hooks.Stop : [];
      return stopHooks.some((entry) => JSON.stringify(entry).includes(EMDASH_MARKER));
    },
  };
}

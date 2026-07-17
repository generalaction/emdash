import type { PluginFs } from '@emdash/core/agents/plugins';
import type { HookRegistration } from '@emdash/core/agents/plugins';
import {
  EMDASH_MARKER,
  buildNestedEntry,
  filterUserHooks,
  makeStdinHookCommand,
  readJsonConfig,
  writeJsonConfig,
} from '@emdash/core/agents/plugins/helpers';

export const GOOSE_PLUGIN_MANIFEST_PATH = '.agents/plugins/emdash/plugin.json';
export const GOOSE_HOOKS_PATH = '.agents/plugins/emdash/hooks/hooks.json';

const GOOSE_PLUGIN_MANIFEST = {
  name: 'emdash',
  version: '0.1.0',
  description: 'Emdash lifecycle hooks for Goose sessions',
};

const GOOSE_HOOK_SPECS = [
  { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
  { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
  { hookKey: 'PreToolUse', command: makeStdinHookCommand('start') },
  { hookKey: 'PostToolUse', command: makeStdinHookCommand('tool-use') },
  { hookKey: 'PostToolUseFailure', command: makeStdinHookCommand('error') },
  { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
];

const specsByHookKey = new Map<string, typeof GOOSE_HOOK_SPECS>();
for (const spec of GOOSE_HOOK_SPECS) {
  specsByHookKey.set(spec.hookKey, [...(specsByHookKey.get(spec.hookKey) ?? []), spec]);
}

function getHooks(config: Record<string, unknown>): Record<string, unknown[]> {
  return (config.hooks ?? {}) as Record<string, unknown[]>;
}

function hasAllManagedHooks(hooks: Record<string, unknown[]>): boolean {
  return [...specsByHookKey].every(([hookKey, specs]) => {
    const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
    const serializedEntries = entries.map((entry) => JSON.stringify(entry));
    return specs.every(({ command }) =>
      serializedEntries.includes(JSON.stringify(buildNestedEntry(command)))
    );
  });
}

export function buildGooseHookConfig() {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, GOOSE_HOOKS_PATH);
      return hasAllManagedHooks(getHooks(config))
        ? [{ event: 'emdash', command: EMDASH_MARKER }]
        : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      await writeJsonConfig(fs, GOOSE_PLUGIN_MANIFEST_PATH, GOOSE_PLUGIN_MANIFEST);

      const config = await readJsonConfig(fs, GOOSE_HOOKS_PATH);
      const hooks = getHooks(config);

      for (const [hookKey, specs] of specsByHookKey) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = [
          ...filterUserHooks(existing as Record<string, unknown>[]),
          ...specs.map(({ command }) => buildNestedEntry(command)),
        ];
      }

      await writeJsonConfig(fs, GOOSE_HOOKS_PATH, { ...config, hooks });
      return [GOOSE_PLUGIN_MANIFEST_PATH, GOOSE_HOOKS_PATH];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, GOOSE_HOOKS_PATH);
      const hooks = getHooks(config);
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, GOOSE_HOOKS_PATH, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, GOOSE_HOOKS_PATH);
      return hasAllManagedHooks(getHooks(config));
    },
  };
}

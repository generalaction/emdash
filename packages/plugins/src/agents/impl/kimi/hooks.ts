import type { PluginFs } from '@emdash/shared/agents/plugins';
import type { HookRegistration } from '@emdash/shared/agents/plugins';
import {
  EMDASH_MARKER,
  filterUserHooks,
  makeStdinHookCommand,
} from '@emdash/shared/agents/plugins/helpers';
import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';

export const KIMI_CONFIG_PATH = '.kimi-code/config.toml';
export const KIMI_LEGACY_CONFIG_PATH = '.kimi/config.toml';

const KIMI_HOOK_SPECS = [
  { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
  { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
  { hookKey: 'PostToolUse', command: makeStdinHookCommand('start') },
  { hookKey: 'PostToolUseFailure', command: makeStdinHookCommand('start') },
  { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
  { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  { hookKey: 'StopFailure', command: makeStdinHookCommand('stop') },
  { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
];

function buildKimiHookEntries(existing: unknown[]): unknown[] {
  const userEntries = filterUserHooks(existing as Record<string, unknown>[]);
  const emdashEntries = KIMI_HOOK_SPECS.map(({ hookKey, command }) => ({
    event: hookKey,
    command,
  }));
  return [...userEntries, ...emdashEntries];
}

/**
 * Inject kimi hooks into an inline --config JSON/TOML text string.
 * Used by the kimi buildCommand to patch the --config= flag value on the fly.
 */
export function addKimiHooksToConfigText(content: string): string {
  try {
    const config = JSON.parse(content) as Record<string, unknown>;
    const hooks = Array.isArray(config.hooks) ? config.hooks : [];
    config.hooks = buildKimiHookEntries(hooks);
    return JSON.stringify(config);
  } catch {
    /* fall through to TOML */
  }
  try {
    const config = parseTOML(content) as Record<string, unknown>;
    const hooks = Array.isArray(config.hooks) ? config.hooks : [];
    config.hooks = buildKimiHookEntries(hooks);
    return stringifyTOML(config);
  } catch {
    return content;
  }
}

async function writeKimiHookPath(fs: PluginFs, path: string): Promise<boolean> {
  const content = await fs.read(path);
  let config: Record<string, unknown> = {};
  if (content) {
    try {
      config = parseTOML(content) as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  const hooks = Array.isArray(config.hooks) ? config.hooks : [];
  config.hooks = buildKimiHookEntries(hooks);
  await fs.write(path, stringifyTOML(config));
  return true;
}

export function buildKimiHookConfig() {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      for (const path of [KIMI_CONFIG_PATH, KIMI_LEGACY_CONFIG_PATH]) {
        const content = await fs.read(path);
        if (!content) continue;
        try {
          const config = parseTOML(content) as Record<string, unknown>;
          const hooks = Array.isArray(config.hooks) ? config.hooks : [];
          if (hooks.some((e) => JSON.stringify(e).includes(EMDASH_MARKER))) {
            return [{ event: 'emdash', command: EMDASH_MARKER }];
          }
        } catch {
          /* skip */
        }
      }
      return [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<void> {
      await writeKimiHookPath(fs, KIMI_CONFIG_PATH);
      await writeKimiHookPath(fs, KIMI_LEGACY_CONFIG_PATH);
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      for (const path of [KIMI_CONFIG_PATH, KIMI_LEGACY_CONFIG_PATH]) {
        const content = await fs.read(path);
        if (!content) continue;
        try {
          const config = parseTOML(content) as Record<string, unknown>;
          if (Array.isArray(config.hooks)) {
            config.hooks = filterUserHooks(config.hooks as Record<string, unknown>[]);
          }
          await fs.write(path, stringifyTOML(config));
        } catch {
          /* skip */
        }
      }
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      for (const path of [KIMI_CONFIG_PATH, KIMI_LEGACY_CONFIG_PATH]) {
        const content = await fs.read(path);
        if (!content) continue;
        try {
          const config = parseTOML(content) as Record<string, unknown>;
          const hooks = Array.isArray(config.hooks) ? config.hooks : [];
          if (hooks.some((e) => JSON.stringify(e).includes(EMDASH_MARKER))) return true;
        } catch {
          /* skip */
        }
      }
      return false;
    },
  };
}

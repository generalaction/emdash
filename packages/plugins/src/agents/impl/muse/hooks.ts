import path from 'node:path';
import type { PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import {
  buildNestedJsonHookConfig,
  configRoots,
  defaultHookEventParser,
  EMDASH_MARKER,
  extractProviderSessionId,
  makeStdinHookCommand,
  readJsonConfig,
  writeJsonConfig,
  xdgConfigRoot,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';

export const MUSE_SETTINGS_PATH = 'settings.json';
export const MUSE_HOOKS_PATH = 'emdash-hooks.json';
export const MUSE_HOOK_ENV_VARS = ['EMDASH_HOOK_PORT', 'EMDASH_HOOK_NONCE', 'EMDASH_PTY_ID'];

async function readSettings(fs: PluginFs) {
  const settings = await readJsonConfig(fs, MUSE_SETTINGS_PATH);
  if (settings.schema_version !== undefined && settings.schema_version !== 1) {
    throw new Error('Unsupported Muse settings schema_version; expected 1');
  }
  const envVars = settings.managed_hooks_env_vars ?? [];
  if (!Array.isArray(envVars) || !envVars.every((value) => typeof value === 'string')) {
    throw new Error('Invalid Muse managed_hooks_env_vars; expected an array of strings');
  }
  const hooksPath = settings.managed_hooks_path ?? MUSE_HOOKS_PATH;
  // PluginFs is confined to the provider config root. Never replace an external
  // managed hook source or copy its contents into an Emdash-owned file.
  if (
    typeof hooksPath !== 'string' ||
    !hooksPath.trim() ||
    path.posix.isAbsolute(hooksPath) ||
    path.win32.isAbsolute(hooksPath) ||
    hooksPath.includes('\\') ||
    hooksPath.split('/').some((part) => part === '..' || part === '.') ||
    hooksPath.startsWith('~') ||
    hooksPath.includes('$') ||
    hooksPath === MUSE_SETTINGS_PATH
  ) {
    throw new Error(
      'Muse managed_hooks_path must name a hook file inside the Muse config directory; existing settings were left unchanged'
    );
  }
  return { settings, envVars, hooksPath };
}

function hookConfig(hooksPath: string) {
  return buildNestedJsonHookConfig(hooksPath, [
    { hookKey: 'SessionStart', command: makeStdinHookCommand('session-start') },
    { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
    { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  ]);
}

export function buildMuseHookConfig() {
  async function getHooksInstalled(fs: PluginFs): Promise<boolean> {
    const { settings, envVars, hooksPath } = await readSettings(fs);
    return (
      settings.schema_version === 1 &&
      settings.managed_hooks_path === hooksPath &&
      MUSE_HOOK_ENV_VARS.every((name) => envVars.includes(name)) &&
      (await hookConfig(hooksPath).getHooksInstalled(fs))
    );
  }

  return {
    resolveConfigRoots: configRoots(xdgConfigRoot('muse')),
    getHooksInstalled,
    async readHooks(fs: PluginFs) {
      return (await getHooksInstalled(fs)) ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs) {
      const { settings, envVars, hooksPath } = await readSettings(fs);
      // Validate the existing hook document before changing files.
      await hookConfig(hooksPath).readHooks(fs);
      await hookConfig(hooksPath).writeHooks(fs, []);
      // Muse strips these variables from ordinary user hooks. Only managed
      // hooks receive the explicit allowlist from user settings.
      await writeJsonConfig(fs, MUSE_SETTINGS_PATH, {
        ...settings,
        schema_version: 1,
        managed_hooks_path: hooksPath,
        managed_hooks_env_vars: [...new Set([...envVars, ...MUSE_HOOK_ENV_VARS])],
      });
      return [hooksPath, MUSE_SETTINGS_PATH];
    },
    async deleteHooks(fs: PluginFs) {
      const { settings, hooksPath } = await readSettings(fs);
      if (settings.managed_hooks_path === undefined) return;
      // Retain shared settings and allowlists: other managed hooks may use them.
      await hookConfig(hooksPath).deleteHooks(fs);
    },
    parseHookEvent(eventType: string, body: Record<string, unknown>) {
      const sessionId = extractProviderSessionId(body);
      const event = defaultHookEventParser(eventType, body);
      if (event.kind !== 'status') return event;
      return sessionId ? { ...event, providerSessionId: sessionId } : event;
    },
  };
}

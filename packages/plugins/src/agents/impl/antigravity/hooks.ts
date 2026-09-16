import type { CanonicalHookEvent, PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import {
  configRoots,
  EMDASH_MARKER,
  filterUserHooks,
  homeConfigRoot,
  type HookCommandOptions,
  makeStdinHookCommand,
  readJsonConfig,
  writeJsonConfig,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';

const MANIFEST_PATH = 'plugins/emdash/plugin.json';
const HOOKS_PATH = 'plugins/emdash/hooks.json';
const MANIFEST = { name: 'emdash', description: 'Emdash lifecycle hooks for Antigravity sessions' };

// Antigravity consumes stdout as hook decisions. Never expose the transport's
// HTTP response as a decision, and never ask the agent to continue executing.
function buildHooks(opts: HookCommandOptions) {
  return {
    PreInvocation: {
      type: 'command',
      command: makeStdinHookCommand('start', { ...opts, stdoutJson: {} }),
    },
    Stop: {
      type: 'command',
      command: makeStdinHookCommand('stop', { ...opts, stdoutJson: { decision: 'stop' } }),
    },
  };
}

async function readConfig(fs: PluginFs) {
  const manifest = await readJsonConfig(fs, MANIFEST_PATH);
  if (manifest.name !== undefined && manifest.name !== MANIFEST.name) {
    throw new Error('Antigravity Emdash plugin path contains another plugin');
  }
  const config = await readJsonConfig(fs, HOOKS_PATH);
  const definition = config.emdash ?? {};
  if (typeof definition !== 'object' || Array.isArray(definition) || definition === null) {
    throw new Error('Invalid Antigravity emdash hook definition');
  }
  const hooks = definition as Record<string, unknown>;
  for (const key of ['PreInvocation', 'Stop']) {
    if (hooks[key] !== undefined && !Array.isArray(hooks[key])) {
      throw new Error(`Invalid Antigravity ${key} hooks; expected an array`);
    }
  }
  return { manifest, config, hooks };
}

export function buildAntigravityHookConfig(opts: HookCommandOptions = {}) {
  const managedHooks = buildHooks(opts);
  async function getHooksInstalled(fs: PluginFs): Promise<boolean> {
    const { manifest, hooks } = await readConfig(fs);
    return (
      manifest.name === MANIFEST.name &&
      hooks.enabled !== false &&
      Object.entries(managedHooks).every(([key, handler]) =>
        (hooks[key] as unknown[] | undefined)?.some(
          (entry) => JSON.stringify(entry) === JSON.stringify(handler)
        )
      )
    );
  }

  return {
    // The CLI reads lifecycle customizations from the shared config root.
    // Its antigravity-cli directory stores CLI state, but plugins there are not discovered.
    resolveConfigRoots: configRoots(homeConfigRoot('.gemini/config')),
    getHooksInstalled,
    async readHooks(fs: PluginFs) {
      return (await getHooksInstalled(fs)) ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs) {
      const { manifest, config, hooks } = await readConfig(fs);
      for (const [key, handler] of Object.entries(managedHooks)) {
        hooks[key] = [...filterUserHooks((hooks[key] as unknown[] | undefined) ?? []), handler];
      }
      await writeJsonConfig(fs, MANIFEST_PATH, { ...MANIFEST, ...manifest });
      await writeJsonConfig(fs, HOOKS_PATH, {
        ...config,
        emdash: { ...hooks, enabled: true },
      });
      return [MANIFEST_PATH, HOOKS_PATH];
    },
    async deleteHooks(fs: PluginFs) {
      const { config, hooks } = await readConfig(fs);
      for (const key of Object.keys(managedHooks)) {
        if (Array.isArray(hooks[key])) hooks[key] = filterUserHooks(hooks[key]);
      }
      await writeJsonConfig(fs, HOOKS_PATH, { ...config, emdash: hooks });
    },
    parseHookEvent(eventType: string, body: Record<string, unknown>): CanonicalHookEvent {
      const providerSessionId =
        typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
      if (!providerSessionId) return { kind: 'ignore' };
      if (eventType === 'start') {
        return { kind: 'status', type: 'start', providerSessionId };
      }
      if (eventType !== 'stop' || body.fullyIdle !== true) return { kind: 'ignore' };
      const error = typeof body.error === 'string' ? body.error.trim() : '';
      if (body.terminationReason === 'error' || error) {
        return { kind: 'status', type: 'error', providerSessionId, message: error || undefined };
      }
      return { kind: 'status', type: 'stop', providerSessionId };
    },
  };
}

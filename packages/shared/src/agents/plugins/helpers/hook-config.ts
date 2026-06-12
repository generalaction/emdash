import type { PluginFs } from '../../runtime/fs';
import type { HookRegistration } from '../capabilities/hooks';
import { EMDASH_MARKER, filterUserHooks } from './hooks';

export type { HookCommandOptions } from './hooks';

// ── JSON config helpers ────────────────────────────────────────────────────

export async function readJsonConfig(fs: PluginFs, path: string): Promise<Record<string, unknown>> {
  const content = await fs.read(path);
  if (!content) return {};
  try {
    return (JSON.parse(content) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export async function writeJsonConfig(
  fs: PluginFs,
  path: string,
  config: Record<string, unknown>
): Promise<void> {
  await fs.write(path, JSON.stringify(config, null, 2) + '\n');
}

// ── Entry builders ─────────────────────────────────────────────────────────

/** Claude/Codex-style nested entry: `{ hooks: [{ type: 'command', command }] }` */
export function buildNestedEntry(command: string): Record<string, unknown> {
  return { hooks: [{ type: 'command', command }] };
}

/** Copilot-style flat entry: `{ type: 'command', command }` */
export function buildFlatEntry(command: string): Record<string, unknown> {
  return { type: 'command', command };
}

/** Kiro-style minimal entry: `{ command }` */
export function buildMinimalEntry(command: string): Record<string, unknown> {
  return { command };
}

// ── Merge helpers ───────────────────────────────────────────────────────────

export function mergeNestedEntries(existing: unknown[], command: string): unknown[] {
  return [...filterUserHooks(existing as Record<string, unknown>[]), buildNestedEntry(command)];
}

export function mergeFlatEntries(existing: unknown[], command: string): unknown[] {
  return [...filterUserHooks(existing as Record<string, unknown>[]), buildFlatEntry(command)];
}

export function mergeMinimalEntries(existing: unknown[], command: string): unknown[] {
  return [...filterUserHooks(existing as Record<string, unknown>[]), buildMinimalEntry(command)];
}

// ── Generic hook config builders ────────────────────────────────────────────

type HookSpec = { hookKey: string; command: string };

/**
 * Build an `IHooksBehavior` for agents that store hooks in a JSON file using
 * the nested format:
 *   `{ hooks: { <Event>: [{ hooks: [{ type: 'command', command }] }] } }`
 *
 * Pass pre-built command strings (from `makeStdinHookCommand`, etc.) in `hookSpecs`.
 */
export function buildNestedJsonHookConfig(configPath: string, hookSpecs: HookSpec[]) {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = hookSpecs.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const { hookKey, command } of hookSpecs) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeNestedEntries(existing, command);
      }
      await writeJsonConfig(fs, configPath, { ...config, hooks });
      return [configPath];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, configPath, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return hookSpecs.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

/**
 * Build an `IHooksBehavior` for agents that store hooks in a JSON file using
 * the flat format: `{ hooks: { <Event>: [{ type: 'command', command }] } }`
 *
 * Optionally pass `extraFields` to merge at the config root (e.g. copilot `version`).
 */
export function buildFlatJsonHookConfig(
  configPath: string,
  hookSpecs: HookSpec[],
  extraRoot?: Record<string, unknown>
) {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = hookSpecs.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const { hookKey, command } of hookSpecs) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeFlatEntries(existing, command);
      }
      await writeJsonConfig(fs, configPath, { ...config, ...extraRoot, hooks });
      return [configPath];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, configPath, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return hookSpecs.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

/**
 * Build an `IHooksBehavior` for agents that store hooks as a minimal
 * `{ command }` object array under `config.hooks.<hookKey>`.
 */
export function buildMinimalJsonHookConfig(
  configPath: string,
  hookSpecs: HookSpec[],
  extraRoot?: Record<string, unknown>
) {
  return {
    async readHooks(fs: PluginFs): Promise<HookRegistration[]> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      const installed = hookSpecs.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
      return installed ? [{ event: 'emdash', command: EMDASH_MARKER }] : [];
    },
    async writeHooks(fs: PluginFs, _hooks: HookRegistration[]): Promise<string[]> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const { hookKey, command } of hookSpecs) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeMinimalEntries(existing, command);
      }
      await writeJsonConfig(fs, configPath, { ...config, ...extraRoot, hooks });
      return [configPath];
    },
    async deleteHooks(fs: PluginFs): Promise<void> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      for (const key of Object.keys(hooks)) {
        hooks[key] = filterUserHooks(hooks[key] as Record<string, unknown>[]);
      }
      await writeJsonConfig(fs, configPath, { ...config, hooks });
    },
    async getHooksInstalled(fs: PluginFs): Promise<boolean> {
      const config = await readJsonConfig(fs, configPath);
      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
      return hookSpecs.some(({ hookKey }) => {
        const entries = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        return entries.some((e) => JSON.stringify(e).includes(EMDASH_MARKER));
      });
    },
  };
}

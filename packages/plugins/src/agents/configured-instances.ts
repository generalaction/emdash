import { readFile } from 'node:fs/promises';
import type { CLIAgentPluginProvider } from '@emdash/core/services/agent-plugins/api/plugins';
import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { z } from 'zod';
import { agentFactories, pluginRegistry, type AgentProviderFactory } from './registry';

/**
 * Each Wire runtime (acp, tui-agents, agent-config, ...) spawns as its own child
 * process with its own module-level `pluginRegistry` — registering a configured
 * instance in one process does not reach the others. Whichever process resolves
 * the config file first (the desktop main process, or the workspace-server host
 * process for a remote workspace) republishes the validated instances through
 * this env var (inherited by every worker that forwards `process.env`), so each
 * worker's entry file can register the same instances into its own registry
 * before it starts serving requests.
 */
export const CONFIGURED_AGENTS_ENV_VAR = 'EMDASH_CONFIGURED_AGENTS';

const configuredAgentInstanceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  extends: z.string().min(1),
});

export type ConfiguredAgentInstance = z.infer<typeof configuredAgentInstanceSchema>;

const agentsConfigSchema = z
  .object({
    providers: z.array(z.unknown()).default([]),
  })
  .strict();

export type ConfiguredAgentInstanceDeps = {
  registry?: PluginRegistry<CLIAgentPluginProvider>;
  factories?: Record<string, AgentProviderFactory>;
};

export type ApplyConfiguredAgentInstancesResult = {
  registeredIds: string[];
  warnings: string[];
};

/**
 * Validates a raw `providers` array from the config file (or from the
 * `CONFIGURED_AGENTS_ENV_VAR` a worker inherited). Lenient per-entry: a malformed
 * entry is dropped with a warning; valid siblings are still returned.
 */
export function parseConfiguredAgentInstances(rawProviders: unknown[]): {
  instances: ConfiguredAgentInstance[];
  warnings: string[];
} {
  const instances: ConfiguredAgentInstance[] = [];
  const warnings: string[] = [];
  for (const rawEntry of rawProviders) {
    const entry = configuredAgentInstanceSchema.safeParse(rawEntry);
    if (!entry.success) {
      warnings.push(`skipped invalid provider entry: ${entry.error.message}`);
      continue;
    }
    instances.push(entry.data);
  }
  return { instances, warnings };
}

/**
 * Registers already-validated instances into a plugin registry. Skips (with a
 * warning) an id that collides with an already-registered provider, an unknown
 * `extends`, or a factory lookup/construction failure, without rejecting the
 * other instances.
 */
export function applyConfiguredAgentInstances(
  instances: ConfiguredAgentInstance[],
  deps: ConfiguredAgentInstanceDeps = {}
): ApplyConfiguredAgentInstancesResult {
  const registry = deps.registry ?? pluginRegistry;
  const factories = deps.factories ?? agentFactories;
  const warnings: string[] = [];
  const registeredIds: string[] = [];
  const seenIds = new Set<string>();

  for (const { id, name, extends: baseId } of instances) {
    if (registry.get(id) || seenIds.has(id)) {
      warnings.push(`skipped provider '${id}': id is already registered`);
      continue;
    }

    // `factories` is a plain object: a bracket lookup without an own-property
    // check would resolve an inherited Object.prototype member (e.g. an
    // `extends: "constructor"` entry), producing something with no provider
    // shape and crashing registration. Config-declared strings must never be
    // trusted with a bare `factories[baseId]`.
    const factory = Object.hasOwn(factories, baseId) ? factories[baseId] : undefined;
    if (!factory) {
      warnings.push(
        `skipped provider '${id}': unknown extends '${baseId}' ` +
          `(supported: ${Object.keys(factories).join(', ')})`
      );
      continue;
    }

    try {
      registry.register(factory({ id, name }));
    } catch (error) {
      warnings.push(`skipped provider '${id}': factory threw: ${String(error)}`);
      continue;
    }
    seenIds.add(id);
    registeredIds.push(id);
  }

  return { registeredIds, warnings };
}

export type LoadConfiguredAgentInstancesResult = ApplyConfiguredAgentInstancesResult & {
  instances: ConfiguredAgentInstance[];
};

/**
 * Reads user-declared extra agent instances (e.g. a second Claude account) from
 * a JSON file (`agents.json` in the host's emdash data directory) and registers
 * them into the plugin registry. Read once at boot — no live reload; editing the
 * file requires an app restart, matching host-settings.json's out-of-band-edit
 * story.
 *
 * Called once, in whichever process owns the config file (the desktop main
 * process locally, or the workspace-server host process for a remote
 * workspace), before any Wire worker is spawned. The returned `instances` must
 * be republished via `CONFIGURED_AGENTS_ENV_VAR` so worker processes can
 * register the same instances into their own registry (see
 * `applyConfiguredAgentInstancesFromEnv`).
 */
export async function loadConfiguredAgentInstances(
  configPath: string,
  deps: ConfiguredAgentInstanceDeps = {}
): Promise<LoadConfiguredAgentInstancesResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    const warnings = isMissingFileError(error)
      ? []
      : [`${configPath} could not be read or parsed: ${String(error)}`];
    return { instances: [], registeredIds: [], warnings };
  }

  const config = agentsConfigSchema.safeParse(raw);
  if (!config.success) {
    return {
      instances: [],
      registeredIds: [],
      warnings: [`${configPath} has an invalid top-level shape: ${config.error.message}`],
    };
  }

  const parsed = parseConfiguredAgentInstances(config.data.providers);
  const applied = applyConfiguredAgentInstances(parsed.instances, deps);
  return {
    instances: parsed.instances,
    registeredIds: applied.registeredIds,
    warnings: [...parsed.warnings, ...applied.warnings],
  };
}

/**
 * Worker-process counterpart to `loadConfiguredAgentInstances`: reads the
 * instances the owning process resolved (via `CONFIGURED_AGENTS_ENV_VAR`,
 * inherited because worker specs pass `env: process.env`) and registers them
 * into this process's own `pluginRegistry`. A no-op when the env var is
 * absent, empty, or malformed — never throws, so a worker always boots even if
 * config was invalid.
 */
export function applyConfiguredAgentInstancesFromEnv(
  logger: Pick<Logger, 'warn'>,
  deps: ConfiguredAgentInstanceDeps = {}
): void {
  const raw = process.env[CONFIGURED_AGENTS_ENV_VAR];
  if (!raw) return;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    logger.warn('failed to parse configured agent instances env var', { error: String(error) });
    return;
  }
  if (!Array.isArray(parsedJson)) return;

  const { instances, warnings: parseWarnings } = parseConfiguredAgentInstances(parsedJson);
  const { warnings: applyWarnings } = applyConfiguredAgentInstances(instances, deps);
  for (const warning of [...parseWarnings, ...applyWarnings]) {
    logger.warn('configured agent instance skipped', { warning });
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

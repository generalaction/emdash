import { err, ok, type Result } from '@emdash/shared';
import {
  buildAllowlistedAgentEnv,
  currentAgentEnvPlatform,
  mergeAgentEnvLayers,
  type AgentEnvPlatform,
} from '#primitives/agent-env/api';
import type { EnvSource } from '#primitives/exec/api';

export type SpawnContext = {
  cli: string;
  agentEnv: Record<string, string>;
};

export type SpawnContextError =
  | { type: 'unknown-provider'; providerId: string }
  | { type: 'environment-unavailable'; providerId: string; message: string }
  | { type: 'cli-not-found'; providerId: string; message: string };

export interface SpawnContextResolver {
  resolve(
    providerId: string,
    envOverrides?: Record<string, string>
  ): Promise<Result<SpawnContext, SpawnContextError>>;
  invalidate(providerId?: string): void;
}

export type CreateSpawnContextResolverOptions = {
  resolveCli: (providerId: string) => Promise<string>;
  env: EnvSource;
  envKeys?: (providerId: string, env: Record<string, string>) => Promise<readonly string[]>;
  homeDir: string;
  includeShellVar?: boolean;
  platform?: AgentEnvPlatform;
  hasProvider?: (providerId: string) => boolean;
};

export function createSpawnContextResolver(
  options: CreateSpawnContextResolverOptions
): SpawnContextResolver {
  const resolve = async (
    providerId: string,
    envOverrides?: Record<string, string>
  ): Promise<Result<SpawnContext, SpawnContextError>> => {
    if (options.hasProvider && !options.hasProvider(providerId)) {
      return err({ type: 'unknown-provider', providerId });
    }

    let cli: string;
    try {
      cli = await options.resolveCli(providerId);
    } catch (error: unknown) {
      return err({
        type: 'cli-not-found',
        providerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      return ok({ cli, agentEnv: await buildAgentEnv(options, providerId, envOverrides) });
    } catch (error: unknown) {
      return err({
        type: 'environment-unavailable',
        providerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const invalidate = (_providerId?: string): void => {};

  return { resolve, invalidate };
}

async function buildAgentEnv(
  options: CreateSpawnContextResolverOptions,
  providerId: string,
  envOverrides?: Record<string, string>
): Promise<Record<string, string>> {
  const source = mergeAgentEnvLayers(
    options.platform ?? currentAgentEnvPlatform(),
    await options.env(),
    envOverrides ?? {}
  );
  const base = buildAllowlistedAgentEnv(source, options);
  const extraKeys = await options.envKeys?.(providerId, base);
  return buildAllowlistedAgentEnv(source, {
    extraKeys,
    homeDir: options.homeDir,
    includeShellVar: options.includeShellVar,
    platform: options.platform,
  });
}

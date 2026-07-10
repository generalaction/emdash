import { err, ok, type Result } from '@emdash/shared';
import { deduplicateRequests } from '@emdash/wire/util';
import { buildAllowlistedAgentEnv } from './agent-env';

export type SpawnContext = {
  cli: string;
  agentEnv: Record<string, string>;
};

export type SpawnContextError =
  | { type: 'unknown-provider'; providerId: string }
  | { type: 'cli-not-found'; providerId: string; message: string };

export interface SpawnContextResolver {
  resolve(providerId: string): Promise<Result<SpawnContext, SpawnContextError>>;
  invalidate(providerId?: string): void;
}

export type CreateSpawnContextResolverOptions = {
  resolveCli: (providerId: string) => Promise<string>;
  env: Record<string, string | undefined>;
  homeDir: string;
  includeShellVar?: boolean;
  hasProvider?: (providerId: string) => boolean;
};

export function createSpawnContextResolver(
  options: CreateSpawnContextResolverOptions
): SpawnContextResolver {
  const cliCache = new Map<string, string>();
  let generation = 0;
  const resolveCliOnce = deduplicateRequests(
    async (input: {
      providerId: string;
      generation: number;
    }): Promise<Result<string, SpawnContextError>> => {
      try {
        const cli = await options.resolveCli(input.providerId);
        if (input.generation === generation) cliCache.set(input.providerId, cli);
        return ok(cli) as Result<string, SpawnContextError>;
      } catch (error: unknown) {
        return err({
          type: 'cli-not-found',
          providerId: input.providerId,
          message: error instanceof Error ? error.message : String(error),
        } satisfies SpawnContextError);
      }
    },
    { key: (input) => `${input.providerId}:${input.generation}` }
  );

  const resolve = async (providerId: string): Promise<Result<SpawnContext, SpawnContextError>> => {
    if (options.hasProvider && !options.hasProvider(providerId)) {
      return err({ type: 'unknown-provider', providerId });
    }

    const cachedCli = cliCache.get(providerId);
    if (cachedCli) return ok({ cli: cachedCli, agentEnv: buildAgentEnv() });

    const cliResult = await resolveCli(providerId);
    if (!cliResult.success) return cliResult;
    return ok({ cli: cliResult.data, agentEnv: buildAgentEnv() });
  };

  const invalidate = (providerId?: string): void => {
    generation++;
    if (providerId) {
      cliCache.delete(providerId);
      return;
    }
    cliCache.clear();
  };

  return { resolve, invalidate };

  function buildAgentEnv(): Record<string, string> {
    return buildAllowlistedAgentEnv(options.env, {
      homeDir: options.homeDir,
      includeShellVar: options.includeShellVar,
    });
  }

  async function resolveCli(providerId: string): Promise<Result<string, SpawnContextError>> {
    return resolveCliOnce({ providerId, generation });
  }
}

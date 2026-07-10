import { err, ok, type Result } from '@emdash/shared';
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
  const pending = new Map<string, Promise<Result<string, SpawnContextError>>>();

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
    if (providerId) {
      cliCache.delete(providerId);
      pending.delete(providerId);
      return;
    }
    cliCache.clear();
    pending.clear();
  };

  return { resolve, invalidate };

  function buildAgentEnv(): Record<string, string> {
    return buildAllowlistedAgentEnv(options.env, {
      homeDir: options.homeDir,
      includeShellVar: options.includeShellVar,
    });
  }

  async function resolveCli(providerId: string): Promise<Result<string, SpawnContextError>> {
    const active = pending.get(providerId);
    if (active) return active;

    const promise = options
      .resolveCli(providerId)
      .then((cli) => {
        cliCache.set(providerId, cli);
        return ok(cli) as Result<string, SpawnContextError>;
      })
      .catch((error: unknown) =>
        err({
          type: 'cli-not-found',
          providerId,
          message: error instanceof Error ? error.message : String(error),
        } satisfies SpawnContextError)
      )
      .finally(() => {
        pending.delete(providerId);
      });
    pending.set(providerId, promise);
    return promise;
  }
}

import {
  normalizeRepositoryHost,
  parseRepositoryRef,
  type RepositoryRef,
} from '@emdash/core/primitives/repository/api';
import {
  repositoryPluginRegistry,
  type RepositoryHostProbeError,
  type RepositoryHostProbeResult,
  type RepositoryPluginProvider,
} from '@emdash/plugins/repository';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { getProviderAccountService } from '@core/services/provider-accounts/node/provider-account-service';

const PROBE_POSITIVE_TTL_MS = 15 * 60 * 1000;
const PROBE_NEGATIVE_TTL_MS = 2 * 60 * 1000;

export type RepositoryRoute = { integrationId: string; repository: RepositoryRef };

export type RepositoryRouteError =
  | { type: 'invalid_remote' }
  | { type: 'no_integration_for_host'; host: string }
  | { type: 'ambiguous_host'; host: string; integrationIds: string[] }
  | { type: 'host_unreachable'; host: string; reason: string }
  | { type: 'host_error'; host: string; reason: string };

export type RepositoryRouteResult = Result<RepositoryRoute, RepositoryRouteError>;

export type RepositoryRouterDependencies = {
  plugins(): RepositoryPluginProvider[];
  listAccounts(integrationId: string): Promise<Pick<ProviderAccountSummary, 'host'>[]>;
  now?(): number;
};

type ProbeCacheEntry = { result: RepositoryHostProbeResult; expiresAt: number };

/**
 * Maps a git remote to the integration that owns its host. There is no
 * default integration: a host no repository plugin claims is an error.
 *
 * Order: a plugin's declared `knownHosts`, then an integration with a connected
 * account on the host (confirmed by its `probeHost` when it has one), then
 * `probeHost` across all plugins (GitHub Enterprise before any account is
 * connected).
 */
export class RepositoryRouter {
  private readonly probeCache = new Map<string, ProbeCacheEntry>();
  private readonly probesInflight = new Map<string, Promise<RepositoryHostProbeResult>>();

  constructor(private readonly dependencies: RepositoryRouterDependencies) {}

  async route(remoteUrl: string | null | undefined): Promise<RepositoryRouteResult> {
    const repository = parseRepositoryRef(remoteUrl);
    if (!repository) return err({ type: 'invalid_remote' });
    const host = normalizeRepositoryHost(repository.host);
    const plugins = this.dependencies.plugins();

    const owner = plugins.find((plugin) =>
      plugin.capabilities.repository.knownHosts.some(
        (known) => normalizeRepositoryHost(known) === host
      )
    );
    if (owner) return ok({ integrationId: owner.metadata.integrationId, repository });

    const connected = await this.integrationsWithAccountOn(host, plugins);
    if (connected.length > 1) {
      return err({ type: 'ambiguous_host', host, integrationIds: connected });
    }
    // A connected account narrows the candidates but does not skip that plugin's probe.
    const candidates =
      connected.length === 1
        ? plugins.filter((plugin) => plugin.metadata.integrationId === connected[0])
        : plugins;
    const unprobed = candidates.find((plugin) => !plugin.behavior.repository?.probeHost);
    if (connected.length === 1 && unprobed) {
      return ok({ integrationId: unprobed.metadata.integrationId, repository });
    }
    return await this.routeByProbe(host, repository, candidates);
  }

  private async integrationsWithAccountOn(
    host: string,
    plugins: RepositoryPluginProvider[]
  ): Promise<string[]> {
    const matches = await Promise.all(
      plugins.map(async (plugin) => {
        const accounts = await this.dependencies.listAccounts(plugin.metadata.integrationId);
        return accounts.some(
          (account) => account.host !== undefined && normalizeRepositoryHost(account.host) === host
        )
          ? [plugin.metadata.integrationId]
          : [];
      })
    );
    return matches.flat();
  }

  private async routeByProbe(
    host: string,
    repository: RepositoryRef,
    plugins: RepositoryPluginProvider[]
  ): Promise<RepositoryRouteResult> {
    const probing = plugins.filter((plugin) => plugin.behavior.repository?.probeHost);
    const results = await Promise.all(
      probing.map(async (plugin) => ({
        integrationId: plugin.metadata.integrationId,
        result: await this.probe(plugin, host),
      }))
    );
    const accepted = results.filter((entry) => entry.result.success);
    if (accepted.length === 1) return ok({ integrationId: accepted[0].integrationId, repository });
    if (accepted.length > 1) {
      return err({
        type: 'ambiguous_host',
        host,
        integrationIds: accepted.map((entry) => entry.integrationId),
      });
    }
    // no_integration_for_host requires a definite unsupported_host from every probe.
    const inconclusive = results
      .map((entry) => (entry.result.success ? undefined : entry.result.error))
      .find((error): error is RepositoryHostProbeError => error?.type !== 'unsupported_host');
    if (inconclusive?.type === 'host_unreachable' || inconclusive?.type === 'host_error') {
      return err({ type: inconclusive.type, host, reason: inconclusive.message });
    }
    return err({ type: 'no_integration_for_host', host });
  }

  private async probe(
    plugin: RepositoryPluginProvider,
    host: string
  ): Promise<RepositoryHostProbeResult> {
    const key = `${plugin.metadata.integrationId}\u0000${host}`;
    const now = this.dependencies.now?.() ?? Date.now();
    const cached = this.probeCache.get(key);
    if (cached && cached.expiresAt > now) return cached.result;

    const existing = this.probesInflight.get(key);
    if (existing) return await existing;

    const probeHost = plugin.behavior.repository?.probeHost;
    if (!probeHost) return err({ type: 'unsupported_host', host, message: 'No probe.' });
    const pending = probeHost(
      { log: log.child({ integration: plugin.metadata.integrationId }) },
      host
    ).then((result) => {
      const ttl = result.success ? PROBE_POSITIVE_TTL_MS : PROBE_NEGATIVE_TTL_MS;
      this.probeCache.set(key, {
        result,
        expiresAt: (this.dependencies.now?.() ?? Date.now()) + ttl,
      });
      return result;
    });
    this.probesInflight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.probesInflight.delete(key);
    }
  }
}

export const repositoryRouter = new RepositoryRouter({
  plugins: () => repositoryPluginRegistry.getAll(),
  listAccounts: (integrationId) => getProviderAccountService().listAccounts(integrationId),
});

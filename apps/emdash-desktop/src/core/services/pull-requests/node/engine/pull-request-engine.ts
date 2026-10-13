import { parseRepositoryRef } from '@emdash/core/primitives/repository/api';
import { pullRequestsPluginRegistry } from '@emdash/plugins/pull-requests';
import type {
  PullRequestError,
  PullRequestFile,
  PullRequestMergeOptions,
} from '@emdash/plugins/pull-requests/schemas';
import type {
  PullRequestClient,
  PullRequestHostContext,
  PullRequestRepositoryClient,
} from '@emdash/plugins/pull-requests/types';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import type { ContractClient } from '@emdash/wire/rpc';
import type { GitPlatformAuthContract } from '../../api';

export type PullRequestEngineOptions = {
  auth: ContractClient<GitPlatformAuthContract>;
  scope: Scope;
  logger: Logger;
  createClient?: (integrationId: string, host: PullRequestHostContext) => PullRequestClient | null;
};

function createRegistryClient(
  integrationId: string,
  host: PullRequestHostContext
): PullRequestClient | null {
  return (
    pullRequestsPluginRegistry.get(integrationId)?.behavior.pullRequests?.createClient(host) ?? null
  );
}

/** Dispatches each operation to the pull-requests plugin client of the repository's integration. */
export class PullRequestEngine {
  private readonly clients = new Map<string, PullRequestClient | null>();

  constructor(private readonly options: PullRequestEngineOptions) {}

  async openRepository(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<PullRequestRepositoryClient, PullRequestError>> {
    const client = this.clientFor(repositoryUrl);
    if (!client.success) return client;
    return await client.data.openRepository(repositoryUrl, signal);
  }

  async createPullRequest(
    input: {
      repositoryUrl: string;
      headRepositoryUrl?: string;
      head: string;
      base: string;
      title: string;
      body?: string;
      draft: boolean;
    },
    signal: AbortSignal
  ): Promise<Result<{ url: string; number: number }, PullRequestError>> {
    const client = this.clientFor(input.repositoryUrl);
    if (!client.success) return client;
    return await client.data.createPullRequest(input, signal);
  }

  async mergePullRequest(
    repositoryUrl: string,
    number: number,
    options: PullRequestMergeOptions,
    signal: AbortSignal
  ): Promise<Result<{ sha: string | null; merged: boolean }, PullRequestError>> {
    const client = this.clientFor(repositoryUrl);
    if (!client.success) return client;
    return await client.data.mergePullRequest(repositoryUrl, number, options, signal);
  }

  async markReadyForReview(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>> {
    const client = this.clientFor(repositoryUrl);
    if (!client.success) return client;
    return await client.data.markReadyForReview(repositoryUrl, number, signal);
  }

  async getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequestFile[], PullRequestError>> {
    const client = this.clientFor(repositoryUrl);
    if (!client.success) return client;
    return await client.data.getPullRequestFiles(repositoryUrl, number, signal);
  }

  private clientFor(repositoryUrl: string): Result<PullRequestClient, PullRequestError> {
    const integrationId = 'github';
    let client = this.clients.get(integrationId);
    if (client === undefined) {
      client = (this.options.createClient ?? createRegistryClient)(
        integrationId,
        this.hostContext(integrationId)
      );
      this.clients.set(integrationId, client);
    }
    if (!client) {
      return err({
        type: 'unsupported_provider',
        host: parseRepositoryRef(repositoryUrl)?.host ?? 'unknown',
        reason: `${integrationId} has no pull-request support.`,
      });
    }
    return ok(client);
  }

  private hostContext(integrationId: string): PullRequestHostContext {
    return {
      log: this.options.logger,
      scope: this.options.scope,
      resolveCredentials: async (repositoryUrl, signal) => {
        const auth = await this.options.auth.resolveAuth({ repositoryUrl }, { signal });
        if (!auth.success) return auth;
        // Fail closed: never hand one integration's credentials to another's client.
        if (auth.data.integrationId !== integrationId) {
          return err({
            type: 'account_unresolvable',
            host: parseRepositoryRef(repositoryUrl)?.host ?? 'unknown',
            message: `Repository is connected through ${auth.data.integrationId}, not ${integrationId}.`,
          });
        }
        return ok({ accountId: auth.data.accountId, credentials: auth.data.credentials });
      },
    };
  }
}

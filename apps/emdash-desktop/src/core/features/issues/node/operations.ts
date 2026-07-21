import { err } from '@emdash/shared';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@core/features/issues/api/node/issue-provider';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type {
  ConnectionStatus,
  ConnectionStatusMap,
  IssueContextResult,
  IssueListResult,
  IssueProviderType,
} from '@core/primitives/issue-providers/api';
import type { IssueProviderRegistry } from './registry';

const DEFAULT_CAPABILITIES = {
  requiresProjectPath: false,
  requiresRepositoryUrl: false,
  supportsIssueContext: false,
} as const;

const CONNECTION_CHECK_TIMEOUT_MS = 8_000;

export type IssueOperationsDependencies = {
  projects: Pick<ProjectSessionManager, 'getProject'>;
  providers: IssueProviderRegistry;
};

function timeoutStatus(provider: IssueProvider): ConnectionStatus {
  return {
    connected: false,
    error: `Connection check timed out after ${CONNECTION_CHECK_TIMEOUT_MS}ms.`,
    capabilities: provider.capabilities,
  };
}

function failureStatus(provider: IssueProvider, error: unknown): ConnectionStatus {
  const message = error instanceof Error ? error.message : 'Connection check failed.';
  return {
    connected: false,
    error: message,
    capabilities: provider.capabilities,
  };
}

async function checkProviderConfigured(provider: IssueProvider): Promise<boolean> {
  if (!provider.isConfigured) {
    return (await checkProviderConnection(provider)).connected;
  }

  try {
    return await provider.isConfigured();
  } catch {
    return false;
  }
}

async function checkProviderConnection(provider: IssueProvider): Promise<ConnectionStatus> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<ConnectionStatus>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(timeoutStatus(provider));
    }, CONNECTION_CHECK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([provider.checkConnection(), timeoutPromise]);
  } catch (error) {
    return failureStatus(provider, error);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function withResolvedRemote<T extends IssueQueryOpts>(
  dependencies: IssueOperationsDependencies,
  opts: T
): Promise<T> {
  if (!opts.projectId) return opts;
  const project = dependencies.projects.getProject(opts.projectId);
  if (!project) return opts;

  const remote = await project.gitRepository.getBaseRemote().catch(() => undefined);
  const selectedRemote = opts.remote?.trim() || remote;
  const providedRepositoryUrl = opts.repositoryUrl?.trim();

  const remoteRepositoryUrl =
    !providedRepositoryUrl && selectedRemote
      ? (
          await project.git.repository.model
            .state(project.repository, 'remotes')
            .snapshot()
            .then((snapshot) => snapshot.data.remotes)
            .catch(() => [])
        ).find((candidate) => candidate.name === selectedRemote)?.url
      : undefined;
  const repositoryUrl = providedRepositoryUrl ?? remoteRepositoryUrl;

  return { ...opts, remote: selectedRemote, repositoryUrl };
}

export async function checkConnection(
  dependencies: IssueOperationsDependencies,
  provider: IssueProviderType
): Promise<ConnectionStatus> {
  const issueProvider = dependencies.providers.get(provider);
  if (!issueProvider) {
    return {
      connected: false,
      error: `Unknown provider: ${provider}`,
      capabilities: DEFAULT_CAPABILITIES,
    };
  }

  return checkProviderConnection(issueProvider);
}

export async function checkAllConnections(
  dependencies: IssueOperationsDependencies
): Promise<ConnectionStatusMap> {
  const settled = await Promise.all(
    dependencies.providers.getAll().map(async (provider) => {
      const status = await checkProviderConnection(provider);
      return [provider.type, status] as const;
    })
  );

  return Object.fromEntries(settled) as ConnectionStatusMap;
}

export async function checkConfiguredConnections(
  dependencies: IssueOperationsDependencies
): Promise<Record<IssueProviderType, boolean>> {
  const settled = await Promise.all(
    dependencies.providers.getAll().map(async (provider) => {
      const configured = await checkProviderConfigured(provider);
      return [provider.type, configured] as const;
    })
  );

  return Object.fromEntries(settled) as Record<IssueProviderType, boolean>;
}

export async function listIssues(
  dependencies: IssueOperationsDependencies,
  provider: IssueProviderType,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const issueProvider = dependencies.providers.get(provider);
  if (!issueProvider) {
    return err({ type: 'generic', message: `Unknown provider: ${provider}` });
  }

  return issueProvider.listIssues(await withResolvedRemote(dependencies, opts));
}

export async function searchIssues(
  dependencies: IssueOperationsDependencies,
  provider: IssueProviderType,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const issueProvider = dependencies.providers.get(provider);
  if (!issueProvider) {
    return err({ type: 'generic', message: `Unknown provider: ${provider}` });
  }

  return issueProvider.searchIssues(await withResolvedRemote(dependencies, opts));
}

export async function getIssueContext(
  dependencies: IssueOperationsDependencies,
  provider: IssueProviderType,
  opts: IssueContextOpts
): Promise<IssueContextResult> {
  const issueProvider = dependencies.providers.get(provider);
  if (!issueProvider) {
    return err({ type: 'generic', message: `Unknown provider: ${provider}` });
  }

  if (!issueProvider.getIssueContext) {
    return err({ type: 'generic', message: `${provider} does not support issue context.` });
  }

  return issueProvider.getIssueContext(await withResolvedRemote(dependencies, opts));
}

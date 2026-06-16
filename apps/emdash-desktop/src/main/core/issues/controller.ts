import { projectManager } from '@main/core/projects/project-manager';
import type {
  ConnectionStatus,
  ConnectionStatusMap,
  IssueProviderType,
} from '@shared/issue-providers';
import { createRPCController } from '@shared/lib/ipc/rpc';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from './issue-provider';
import { getAllIssueProviders, getIssueProvider } from './registry';

const DEFAULT_CAPABILITIES = {
  requiresProjectPath: false,
  requiresRepositoryUrl: false,
  supportsIssueContext: false,
} as const;

const CONNECTION_CHECK_TIMEOUT_MS = 8_000;

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

async function withResolvedRemote<T extends IssueQueryOpts>(opts: T): Promise<T> {
  if (!opts.projectId) return opts;
  const project = projectManager.getProject(opts.projectId);
  if (!project) return opts;

  const remote = await project.gitRepository.getBaseRemote().catch(() => undefined);
  const selectedRemote = opts.remote?.trim() || remote;
  const providedRepositoryUrl = opts.repositoryUrl?.trim();

  const remoteRepositoryUrl =
    !providedRepositoryUrl && selectedRemote
      ? (await project.gitRepository.getRemotes().catch(() => [])).find(
          (candidate) => candidate.name === selectedRemote
        )?.url
      : undefined;
  const repositoryUrl = providedRepositoryUrl ?? remoteRepositoryUrl;

  return { ...opts, remote: selectedRemote, repositoryUrl };
}

export const issueController = createRPCController({
  checkConnection: async (provider: IssueProviderType) => {
    const issueProvider = getIssueProvider(provider);
    if (!issueProvider) {
      return {
        connected: false,
        error: `Unknown provider: ${provider}`,
        capabilities: DEFAULT_CAPABILITIES,
      };
    }

    return checkProviderConnection(issueProvider);
  },

  checkAllConnections: async (): Promise<ConnectionStatusMap> => {
    const providers = getAllIssueProviders();

    const settled = await Promise.all(
      providers.map(async (provider) => {
        const status = await checkProviderConnection(provider);
        return [provider.type, status] as const;
      })
    );

    return Object.fromEntries(settled) as ConnectionStatusMap;
  },

  checkConfiguredConnections: async (): Promise<Record<IssueProviderType, boolean>> => {
    const providers = getAllIssueProviders();

    const settled = await Promise.all(
      providers.map(async (provider) => {
        const configured = await checkProviderConfigured(provider);
        return [provider.type, configured] as const;
      })
    );

    return Object.fromEntries(settled) as Record<IssueProviderType, boolean>;
  },

  listIssues: async (provider: IssueProviderType, opts: IssueQueryOpts) => {
    const issueProvider = getIssueProvider(provider);
    if (!issueProvider) {
      return { success: false, error: `Unknown provider: ${provider}` } as const;
    }

    return issueProvider.listIssues(await withResolvedRemote(opts));
  },

  searchIssues: async (provider: IssueProviderType, opts: IssueSearchOpts) => {
    const issueProvider = getIssueProvider(provider);
    if (!issueProvider) {
      return { success: false, error: `Unknown provider: ${provider}` } as const;
    }

    return issueProvider.searchIssues(await withResolvedRemote(opts));
  },

  getIssueContext: async (provider: IssueProviderType, opts: IssueContextOpts) => {
    const issueProvider = getIssueProvider(provider);
    if (!issueProvider) {
      return { success: false, error: `Unknown provider: ${provider}` } as const;
    }

    if (!issueProvider.getIssueContext) {
      return { success: false, error: `${provider} does not support issue context.` } as const;
    }

    return issueProvider.getIssueContext(await withResolvedRemote(opts));
  },
});

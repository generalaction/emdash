import { projectManager } from '@main/core/projects/project-manager';
import { createRPCController } from '@shared/ipc/rpc';
import type {
  ConnectionStatus,
  ConnectionStatusMap,
  IssueProviderType,
} from '@shared/issue-providers';
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
} as const;

const CONNECTION_CHECK_TIMEOUT_MS = 8_000;
const lastSuccessfulConnectionStatus = new Map<IssueProviderType, ConnectionStatus>();

function transientFailureStatus(provider: IssueProvider, error: string): ConnectionStatus {
  const lastSuccessfulStatus = lastSuccessfulConnectionStatus.get(provider.type);
  if (lastSuccessfulStatus) {
    return {
      ...lastSuccessfulStatus,
      error,
    };
  }

  return {
    connected: false,
    error,
    capabilities: provider.capabilities,
  };
}

function failureStatus(provider: IssueProvider, error: unknown): ConnectionStatus {
  const message = error instanceof Error ? error.message : 'Connection check failed.';
  return transientFailureStatus(provider, message);
}

async function checkProviderConnection(provider: IssueProvider): Promise<ConnectionStatus> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<ConnectionStatus>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(
        transientFailureStatus(
          provider,
          `Connection check timed out after ${CONNECTION_CHECK_TIMEOUT_MS}ms.`
        )
      );
    }, CONNECTION_CHECK_TIMEOUT_MS);
  });

  try {
    const status = await Promise.race([provider.checkConnection(), timeoutPromise]);
    if (status.connected) {
      lastSuccessfulConnectionStatus.set(provider.type, status);
    } else {
      lastSuccessfulConnectionStatus.delete(provider.type);
    }
    return status;
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

  const remote = await project.repository.getBaseRemote().catch(() => undefined);
  return { ...opts, remote };
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

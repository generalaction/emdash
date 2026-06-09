import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext } from 'react';
import { rpc } from '@renderer/lib/ipc';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type ConnectionStatusMap,
  type IssueProviderType,
} from '@shared/issue-providers';
import { useProviderConnection } from './use-provider-connection';

export const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;

const DEFAULT_CONNECTION_STATUS: ConnectionStatusMap = Object.fromEntries(
  Object.entries(ISSUE_PROVIDER_CAPABILITIES).map(([provider, capabilities]) => [
    provider,
    { connected: false, capabilities },
  ])
) as ConnectionStatusMap;

const DEFAULT_CONNECT_ERROR = 'Failed to connect.';

function validateTokenInput(token: string): string | null {
  return token.trim() ? null : 'Invalid API key';
}

function validateJiraCredentials(input: {
  siteUrl: string;
  email: string;
  token: string;
}): string | null {
  if (!input.siteUrl?.trim() || !input.email?.trim() || !input.token?.trim()) {
    return 'Site URL, email, and API token are required.';
  }
  return null;
}

function validateInstanceCredentials(input: { instanceUrl: string; token: string }): string | null {
  if (!input.instanceUrl?.trim() || !input.token?.trim()) {
    return 'Instance URL and API token are required.';
  }
  return null;
}

function validateMondayCredentials(input: { token: string; boardUrls: string }): string | null {
  if (!input.token?.trim()) {
    return 'API token is required.';
  }
  return null;
}

function validateTrelloCredentials(input: {
  apiKey: string;
  token: string;
  boardUrls: string;
}): string | null {
  if (!input.apiKey?.trim() || !input.token?.trim()) {
    return 'API key and token are required.';
  }
  return null;
}

const PROVIDER_CONNECTION_CONFIG = {
  linear: {
    connectMutationFn: (apiKey: string) => rpc.linear.saveToken(apiKey),
    disconnectMutationFn: () => rpc.linear.clearToken(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateTokenInput,
  },
  jira: {
    connectMutationFn: (credentials: { siteUrl: string; email: string; token: string }) =>
      rpc.jira.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.jira.clearCredentials(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateJiraCredentials,
  },
  gitlab: {
    connectMutationFn: (credentials: { instanceUrl: string; token: string }) =>
      rpc.gitlab.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.gitlab.clearCredentials(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateInstanceCredentials,
  },
  plain: {
    connectMutationFn: (apiKey: string) => rpc.plain.saveToken(apiKey),
    disconnectMutationFn: () => rpc.plain.clearToken(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateTokenInput,
  },
  forgejo: {
    connectMutationFn: (credentials: { instanceUrl: string; token: string }) =>
      rpc.forgejo.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.forgejo.clearCredentials(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateInstanceCredentials,
  },
  featurebase: {
    connectMutationFn: (apiKey: string) => rpc.featurebase.saveToken(apiKey),
    disconnectMutationFn: () => rpc.featurebase.clearToken(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateTokenInput,
  },
  asana: {
    connectMutationFn: (apiKey: string) => rpc.asana.saveToken(apiKey),
    disconnectMutationFn: () => rpc.asana.clearToken(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateTokenInput,
  },
  monday: {
    connectMutationFn: (credentials: { token: string; boardUrls: string }) =>
      rpc.monday.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.monday.clearCredentials(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateMondayCredentials,
  },
  trello: {
    connectMutationFn: (credentials: { apiKey: string; token: string; boardUrls: string }) =>
      rpc.trello.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.trello.clearCredentials(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateTrelloCredentials,
  },
} as const;

type IntegrationsContextValue = {
  connectionStatus: ConnectionStatusMap;
  configuredConnections: Partial<Record<IssueProviderType, boolean>>;
  isCheckingConfiguredConnections: boolean;
  isCheckingConnections: boolean;

  // Legacy-friendly fields consumed around settings/issue selector.
  isLinearConnected: boolean | null;
  isJiraConnected: boolean | null;
  isGitlabConnected: boolean | null;
  isPlainConnected: boolean | null;
  isForgejoConnected: boolean | null;
  isFeaturebaseConnected: boolean | null;
  isAsanaConnected: boolean | null;
  isMondayConnected: boolean | null;
  isTrelloConnected: boolean | null;

  // Auth mutations stay per provider.
  isLinearLoading: boolean;
  isJiraLoading: boolean;
  isGitlabLoading: boolean;
  isPlainLoading: boolean;
  isForgejoLoading: boolean;
  isFeaturebaseLoading: boolean;
  isAsanaLoading: boolean;
  isMondayLoading: boolean;
  isTrelloLoading: boolean;
  connectLinear: (apiKey: string) => Promise<void>;
  disconnectLinear: () => Promise<void>;
  connectJira: (credentials: { siteUrl: string; email: string; token: string }) => Promise<void>;
  disconnectJira: () => Promise<void>;
  connectGitlab: (credentials: { instanceUrl: string; token: string }) => Promise<void>;
  disconnectGitlab: () => Promise<void>;
  connectPlain: (apiKey: string) => Promise<void>;
  disconnectPlain: () => Promise<void>;
  connectForgejo: (credentials: { instanceUrl: string; token: string }) => Promise<void>;
  disconnectForgejo: () => Promise<void>;
  connectFeaturebase: (apiKey: string) => Promise<void>;
  disconnectFeaturebase: () => Promise<void>;
  connectAsana: (apiKey: string) => Promise<void>;
  disconnectAsana: () => Promise<void>;
  connectMonday: (credentials: { token: string; boardUrls: string }) => Promise<void>;
  disconnectMonday: () => Promise<void>;
  connectTrello: (credentials: {
    apiKey: string;
    token: string;
    boardUrls: string;
  }) => Promise<void>;
  disconnectTrello: () => Promise<void>;
};

const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);

function isConnected(
  statusData: ConnectionStatusMap | undefined,
  provider: IssueProviderType
): boolean | null {
  if (!statusData) {
    return null;
  }

  return !!statusData[provider]?.connected;
}

export function IntegrationsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const {
    data: statusData,
    isFetching: isCheckingConnections,
    isLoading: isInitialConnectionCheck,
  } = useQuery({
    queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY,
    queryFn: () => rpc.issues.checkAllConnections(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: configuredConnections = {}, isFetching: isCheckingConfiguredConnections } =
    useQuery({
      queryKey: [...ISSUE_CONNECTION_STATUS_QUERY_KEY, 'configured'],
      queryFn: () => rpc.issues.checkConfiguredConnections(),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    });

  const invalidateStatuses = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
  }, [queryClient]);

  const linearConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.linear,
    invalidate: invalidateStatuses,
  });
  const jiraConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.jira,
    invalidate: invalidateStatuses,
  });
  const gitlabConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.gitlab,
    invalidate: invalidateStatuses,
  });
  const plainConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.plain,
    invalidate: invalidateStatuses,
  });
  const forgejoConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.forgejo,
    invalidate: invalidateStatuses,
  });
  const featurebaseConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.featurebase,
    invalidate: invalidateStatuses,
  });
  const asanaConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.asana,
    invalidate: invalidateStatuses,
  });
  const mondayConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.monday,
    invalidate: invalidateStatuses,
  });
  const trelloConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.trello,
    invalidate: invalidateStatuses,
  });

  const connectionStatus = statusData ?? DEFAULT_CONNECTION_STATUS;

  return (
    <IntegrationsContext.Provider
      value={{
        connectionStatus,
        configuredConnections,
        isCheckingConfiguredConnections,
        isCheckingConnections,
        isLinearConnected: isConnected(statusData, 'linear'),
        isJiraConnected: isConnected(statusData, 'jira'),
        isGitlabConnected: isConnected(statusData, 'gitlab'),
        isPlainConnected: isConnected(statusData, 'plain'),
        isForgejoConnected: isConnected(statusData, 'forgejo'),
        isFeaturebaseConnected: isConnected(statusData, 'featurebase'),
        isAsanaConnected: isConnected(statusData, 'asana'),
        isMondayConnected: isConnected(statusData, 'monday'),
        isTrelloConnected: isConnected(statusData, 'trello'),
        isLinearLoading: isInitialConnectionCheck || linearConnection.isLoading,
        isJiraLoading: isInitialConnectionCheck || jiraConnection.isLoading,
        isGitlabLoading: isInitialConnectionCheck || gitlabConnection.isLoading,
        isPlainLoading: isInitialConnectionCheck || plainConnection.isLoading,
        isForgejoLoading: isInitialConnectionCheck || forgejoConnection.isLoading,
        isFeaturebaseLoading: isInitialConnectionCheck || featurebaseConnection.isLoading,
        isAsanaLoading: isInitialConnectionCheck || asanaConnection.isLoading,
        isMondayLoading: isInitialConnectionCheck || mondayConnection.isLoading,
        isTrelloLoading: isInitialConnectionCheck || trelloConnection.isLoading,
        connectLinear: linearConnection.connect,
        disconnectLinear: linearConnection.disconnect,
        connectJira: jiraConnection.connect,
        disconnectJira: jiraConnection.disconnect,
        connectGitlab: gitlabConnection.connect,
        disconnectGitlab: gitlabConnection.disconnect,
        connectPlain: plainConnection.connect,
        disconnectPlain: plainConnection.disconnect,
        connectForgejo: forgejoConnection.connect,
        disconnectForgejo: forgejoConnection.disconnect,
        connectFeaturebase: featurebaseConnection.connect,
        disconnectFeaturebase: featurebaseConnection.disconnect,
        connectAsana: asanaConnection.connect,
        disconnectAsana: asanaConnection.disconnect,
        connectMonday: mondayConnection.connect,
        disconnectMonday: mondayConnection.disconnect,
        connectTrello: trelloConnection.connect,
        disconnectTrello: trelloConnection.disconnect,
      }}
    >
      {children}
    </IntegrationsContext.Provider>
  );
}

export function useIntegrationsContext() {
  const ctx = useContext(IntegrationsContext);
  if (!ctx) throw new Error('useIntegrationsContext must be used inside IntegrationsProvider');
  return ctx;
}

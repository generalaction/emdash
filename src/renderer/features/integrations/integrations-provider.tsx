import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext } from 'react';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type ConnectionStatusMap,
  type IssueProviderType,
} from '@shared/issue-providers';
import { rpc } from '@renderer/lib/ipc';
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
} as const;

type IntegrationsContextValue = {
  connectionStatus: ConnectionStatusMap;
  isCheckingConnections: boolean;

  // Legacy-friendly fields consumed around settings/issue selector.
  isLinearConnected: boolean | null;
  isJiraConnected: boolean | null;
  isGitlabConnected: boolean | null;
  isPlainConnected: boolean | null;
  isForgejoConnected: boolean | null;
  isFeaturebaseConnected: boolean | null;

  // Auth mutations stay per provider.
  isLinearLoading: boolean;
  isJiraLoading: boolean;
  isGitlabLoading: boolean;
  isPlainLoading: boolean;
  isForgejoLoading: boolean;
  isFeaturebaseLoading: boolean;
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

  const invalidateProvider = useCallback(
    (provider: IssueProviderType) => {
      queryClient.removeQueries({
        queryKey: ['issues:initial', provider],
      });
      queryClient.removeQueries({
        queryKey: ['issues:search', provider],
      });
      void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
    },
    [queryClient]
  );

  const invalidateLinear = useCallback(() => invalidateProvider('linear'), [invalidateProvider]);
  const invalidateJira = useCallback(() => invalidateProvider('jira'), [invalidateProvider]);
  const invalidateGitlab = useCallback(() => invalidateProvider('gitlab'), [invalidateProvider]);
  const invalidatePlain = useCallback(() => invalidateProvider('plain'), [invalidateProvider]);
  const invalidateForgejo = useCallback(() => invalidateProvider('forgejo'), [invalidateProvider]);
  const invalidateFeaturebase = useCallback(
    () => invalidateProvider('featurebase'),
    [invalidateProvider]
  );

  const linearConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.linear,
    invalidate: invalidateLinear,
  });
  const jiraConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.jira,
    invalidate: invalidateJira,
  });
  const gitlabConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.gitlab,
    invalidate: invalidateGitlab,
  });
  const plainConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.plain,
    invalidate: invalidatePlain,
  });
  const forgejoConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.forgejo,
    invalidate: invalidateForgejo,
  });
  const featurebaseConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.featurebase,
    invalidate: invalidateFeaturebase,
  });

  const connectionStatus = statusData ?? DEFAULT_CONNECTION_STATUS;

  return (
    <IntegrationsContext.Provider
      value={{
        connectionStatus,
        isCheckingConnections,
        isLinearConnected: isConnected(statusData, 'linear'),
        isJiraConnected: isConnected(statusData, 'jira'),
        isGitlabConnected: isConnected(statusData, 'gitlab'),
        isPlainConnected: isConnected(statusData, 'plain'),
        isForgejoConnected: isConnected(statusData, 'forgejo'),
        isFeaturebaseConnected: isConnected(statusData, 'featurebase'),
        isLinearLoading: isInitialConnectionCheck || linearConnection.isLoading,
        isJiraLoading: isInitialConnectionCheck || jiraConnection.isLoading,
        isGitlabLoading: isInitialConnectionCheck || gitlabConnection.isLoading,
        isPlainLoading: isInitialConnectionCheck || plainConnection.isLoading,
        isForgejoLoading: isInitialConnectionCheck || forgejoConnection.isLoading,
        isFeaturebaseLoading: isInitialConnectionCheck || featurebaseConnection.isLoading,
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

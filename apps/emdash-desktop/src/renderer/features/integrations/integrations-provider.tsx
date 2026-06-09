import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext } from 'react';
import { rpc } from '@renderer/lib/ipc';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type ConnectionStatusMap,
  type IssueProviderType,
} from '@shared/issue-providers';
import type { ProviderInput, SetupIntegrationType } from './types';
import { useProviderConnection } from './use-provider-connection';

export const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;

const DEFAULT_CONNECTION_STATUS: ConnectionStatusMap = Object.fromEntries(
  Object.entries(ISSUE_PROVIDER_CAPABILITIES).map(([provider, capabilities]) => [
    provider,
    { connected: false, capabilities },
  ])
) as ConnectionStatusMap;

type ConnectionMutationResult = { success?: boolean; error?: string } | null | undefined;

type ProviderConnectionConfig<P extends SetupIntegrationType> = {
  connectMutationFn: (input: ProviderInput[P]) => Promise<ConnectionMutationResult>;
  disconnectMutationFn: () => Promise<unknown>;
  validateInput?: (input: ProviderInput[P]) => string | null;
};

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

const PROVIDER_CONNECTION_CONFIG: {
  [P in SetupIntegrationType]: ProviderConnectionConfig<P>;
} = {
  linear: {
    connectMutationFn: (apiKey) => rpc.linear.saveToken(apiKey),
    disconnectMutationFn: () => rpc.linear.clearToken(),
    validateInput: validateTokenInput,
  },
  jira: {
    connectMutationFn: (credentials) => rpc.jira.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.jira.clearCredentials(),
    validateInput: validateJiraCredentials,
  },
  gitlab: {
    connectMutationFn: (credentials) => rpc.gitlab.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.gitlab.clearCredentials(),
    validateInput: validateInstanceCredentials,
  },
  plain: {
    connectMutationFn: (apiKey) => rpc.plain.saveToken(apiKey),
    disconnectMutationFn: () => rpc.plain.clearToken(),
    validateInput: validateTokenInput,
  },
  forgejo: {
    connectMutationFn: (credentials) => rpc.forgejo.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.forgejo.clearCredentials(),
    validateInput: validateInstanceCredentials,
  },
  featurebase: {
    connectMutationFn: (apiKey) => rpc.featurebase.saveToken(apiKey),
    disconnectMutationFn: () => rpc.featurebase.clearToken(),
    validateInput: validateTokenInput,
  },
  asana: {
    connectMutationFn: (apiKey) => rpc.asana.saveToken(apiKey),
    disconnectMutationFn: () => rpc.asana.clearToken(),
    validateInput: validateTokenInput,
  },
  monday: {
    connectMutationFn: (credentials) => rpc.monday.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.monday.clearCredentials(),
    validateInput: validateMondayCredentials,
  },
  trello: {
    connectMutationFn: (credentials) => rpc.trello.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.trello.clearCredentials(),
    validateInput: validateTrelloCredentials,
  },
};

type ProviderConnectionEntry<P extends SetupIntegrationType> = {
  connect: (input: ProviderInput[P]) => Promise<void>;
  disconnect: () => Promise<void>;
  isMutating: boolean;
};

type ProviderConnectionMap = {
  [P in SetupIntegrationType]: ProviderConnectionEntry<P>;
};

type IntegrationsContextValue = {
  connectionStatus: ConnectionStatusMap;
  configuredConnections: Partial<Record<IssueProviderType, boolean>>;
  isCheckingConfiguredConnections: boolean;
  isCheckingConnections: boolean;
  providers: ProviderConnectionMap;
};

const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);

export function IntegrationsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: statusData, isFetching: isCheckingConnections } = useQuery({
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
  const providers: ProviderConnectionMap = {
    linear: linearConnection,
    jira: jiraConnection,
    gitlab: gitlabConnection,
    plain: plainConnection,
    forgejo: forgejoConnection,
    featurebase: featurebaseConnection,
    asana: asanaConnection,
    monday: mondayConnection,
    trello: trelloConnection,
  };

  return (
    <IntegrationsContext.Provider
      value={{
        connectionStatus,
        configuredConnections,
        isCheckingConfiguredConnections,
        isCheckingConnections,
        providers,
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

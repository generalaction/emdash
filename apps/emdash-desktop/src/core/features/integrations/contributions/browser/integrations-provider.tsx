import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getIntegrationsClient } from '@core/features/integrations/api/browser/client';
import {
  invalidateProviderAccountState,
  ISSUE_CONNECTION_STATUS_QUERY_KEY,
  useAccounts,
} from '@core/features/integrations/api/browser/use-provider-accounts';
import type { IntegrationProviderDescriptor } from '@core/features/integrations/api/contract';
import type { IntegrationFormInput } from '@core/features/integrations/browser/types';
import { getIssuesClient } from '@core/features/issues/api/browser/client';
import type { ConnectionStatus } from '@core/primitives/issue-providers/api';
import { registerIssueMentionIcons } from '@core/primitives/issues/browser/issue-mention-icons';
import type { ProviderAccountsByProvider } from '@core/primitives/provider-accounts/api';

export const INTEGRATION_PROVIDERS_QUERY_KEY = ['integrations:listProviders'] as const;

type ConnectionStatusByIntegration = Partial<Record<string, ConnectionStatus>>;

type ConnectionMutationResult = { success: true } | { success: false; error: string };
type RawConnectionMutationResult = { success: boolean; error?: string };

type IntegrationsContextValue = {
  integrations: IntegrationProviderDescriptor[];
  integrationById: Partial<Record<string, IntegrationProviderDescriptor>>;
  connectionStatus: ConnectionStatusByIntegration;
  /** Connected accounts per integration, including GitHub. */
  integrationAccounts: ProviderAccountsByProvider;
  isLoadingAccounts: boolean;
  accountsError: Error | null;
  isCheckingConnections: boolean;
  connectIntegration: (
    integrationId: string,
    input: IntegrationFormInput,
    options?: { accountId?: string; displayName?: string }
  ) => Promise<ConnectionMutationResult>;
  /** Remove one saved account. */
  disconnectIntegration: (
    integrationId: string,
    accountId: string
  ) => Promise<ConnectionMutationResult>;
  setDefaultIntegrationAccount: (
    integrationId: string,
    accountId: string
  ) => Promise<ConnectionMutationResult>;
  isIntegrationMutating: (integrationId: string) => boolean;
};

const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);

function defaultConnectionStatuses(
  integrations: IntegrationProviderDescriptor[]
): ConnectionStatusByIntegration {
  return Object.fromEntries(
    integrations
      .filter((integration) => integration.features.includes('issues'))
      .map((integration) => [
        integration.id,
        { connected: false, capabilities: integration.issueCapabilities },
      ])
  );
}

export function IntegrationsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [mutatingIntegrationIds, setMutatingIntegrationIds] = useState<Set<string>>(
    () => new Set()
  );

  const { data: integrations = [] } = useQuery({
    queryKey: INTEGRATION_PROVIDERS_QUERY_KEY,
    queryFn: async () => (await getIntegrationsClient()).listProviders(undefined),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    registerIssueMentionIcons(integrations);
  }, [integrations]);

  const { data: statusData, isFetching: isCheckingConnections } = useQuery({
    queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY,
    queryFn: async () => (await getIssuesClient()).checkAllConnections(undefined),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const {
    data: integrationAccounts = {},
    isPending: isLoadingAccounts,
    error: accountsError,
  } = useAccounts();

  const invalidateStatuses = useCallback(
    () => invalidateProviderAccountState(queryClient),
    [queryClient]
  );

  const setIntegrationMutating = useCallback((integrationId: string, isMutating: boolean) => {
    setMutatingIntegrationIds((current) => {
      if (current.has(integrationId) === isMutating) return current;

      const next = new Set(current);
      if (isMutating) {
        next.add(integrationId);
      } else {
        next.delete(integrationId);
      }
      return next;
    });
  }, []);

  const runConnectionMutation = useCallback(
    async (
      integrationId: string,
      mutation: () => Promise<RawConnectionMutationResult>,
      fallbackError: string
    ): Promise<ConnectionMutationResult> => {
      setIntegrationMutating(integrationId, true);
      try {
        const result = await mutation();
        if (!result.success) {
          return { success: false, error: result.error || fallbackError };
        }
        return { success: true };
      } finally {
        try {
          await invalidateStatuses();
        } finally {
          setIntegrationMutating(integrationId, false);
        }
      }
    },
    [invalidateStatuses, setIntegrationMutating]
  );

  const connectIntegration = useCallback(
    async (
      integrationId: string,
      input: IntegrationFormInput,
      options?: { accountId?: string; displayName?: string }
    ) =>
      runConnectionMutation(
        integrationId,
        () =>
          getIntegrationsClient().then((client) =>
            client.connect({ integrationId, credentials: input, ...options })
          ),
        'Failed to connect.'
      ),
    [runConnectionMutation]
  );

  const disconnectIntegration = useCallback(
    async (integrationId: string, accountId: string) =>
      runConnectionMutation(
        integrationId,
        () =>
          getIntegrationsClient().then((client) => client.disconnect({ integrationId, accountId })),
        'Failed to disconnect.'
      ),
    [runConnectionMutation]
  );

  const setDefaultIntegrationAccount = useCallback(
    async (integrationId: string, accountId: string) =>
      runConnectionMutation(
        integrationId,
        () =>
          getIntegrationsClient().then((client) =>
            client.setDefaultAccount({ integrationId, accountId })
          ),
        'Failed to update the default account.'
      ),
    [runConnectionMutation]
  );

  const isIntegrationMutating = useCallback(
    (integrationId: string) => mutatingIntegrationIds.has(integrationId),
    [mutatingIntegrationIds]
  );

  const connectionStatus = useMemo(
    () => ({ ...defaultConnectionStatuses(integrations), ...(statusData ?? {}) }),
    [integrations, statusData]
  );
  const integrationById = useMemo(
    () =>
      Object.fromEntries(
        integrations.map((integration: IntegrationProviderDescriptor) => [
          integration.id,
          integration,
        ])
      ),
    [integrations]
  );

  return (
    <IntegrationsContext.Provider
      value={{
        integrations,
        integrationById,
        connectionStatus,
        integrationAccounts,
        isLoadingAccounts,
        accountsError,
        isCheckingConnections,
        connectIntegration,
        disconnectIntegration,
        setDefaultIntegrationAccount,
        isIntegrationMutating,
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

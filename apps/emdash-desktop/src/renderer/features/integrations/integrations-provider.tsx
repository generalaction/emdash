import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import type { ConnectionStatus } from '@shared/issue-providers';
import type { IntegrationFormInput } from './types';

export const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;
export const INTEGRATIONS_LIST_QUERY_KEY = ['integrations:list'] as const;

export type IntegrationMetadata = Awaited<ReturnType<typeof rpc.integrations.list>>[number];

type ConnectionStatusByIntegration = Partial<Record<string, ConnectionStatus>>;

type ConnectionMutationResult = { success: true } | { success: false; error: string };
type RawConnectionMutationResult = { success: boolean; error?: string };

type IntegrationsContextValue = {
  integrations: IntegrationMetadata[];
  integrationById: Partial<Record<string, IntegrationMetadata>>;
  connectionStatus: ConnectionStatusByIntegration;
  configuredConnections: Partial<Record<string, boolean>>;
  isCheckingConfiguredConnections: boolean;
  isCheckingConnections: boolean;
  connectIntegration: (
    integrationId: string,
    input: IntegrationFormInput
  ) => Promise<ConnectionMutationResult>;
  disconnectIntegration: (integrationId: string) => Promise<ConnectionMutationResult>;
  isIntegrationMutating: (integrationId: string) => boolean;
};

const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);

function defaultConnectionStatuses(
  integrations: IntegrationMetadata[]
): ConnectionStatusByIntegration {
  return Object.fromEntries(
    integrations
      .filter((integration) => integration.features.includes('issues'))
      .map((integration) => [
        integration.id,
        { connected: false, capabilities: integration.capabilities },
      ])
  );
}

export function IntegrationsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [mutatingIntegrationIds, setMutatingIntegrationIds] = useState<Set<string>>(
    () => new Set()
  );

  const { data: integrations = [] } = useQuery({
    queryKey: INTEGRATIONS_LIST_QUERY_KEY,
    queryFn: () => rpc.integrations.list(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

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
        setIntegrationMutating(integrationId, false);
        invalidateStatuses();
      }
    },
    [invalidateStatuses, setIntegrationMutating]
  );

  const connectIntegration = useCallback(
    async (integrationId: string, input: IntegrationFormInput) =>
      runConnectionMutation(
        integrationId,
        () => rpc.integrations.connect(integrationId, input),
        'Failed to connect.'
      ),
    [runConnectionMutation]
  );

  const disconnectIntegration = useCallback(
    async (integrationId: string) =>
      runConnectionMutation(
        integrationId,
        () => rpc.integrations.disconnect(integrationId),
        'Failed to disconnect.'
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
        integrations.map((integration: IntegrationMetadata) => [integration.id, integration])
      ),
    [integrations]
  );

  return (
    <IntegrationsContext.Provider
      value={{
        integrations,
        integrationById,
        connectionStatus,
        configuredConnections,
        isCheckingConfiguredConnections,
        isCheckingConnections,
        connectIntegration,
        disconnectIntegration,
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

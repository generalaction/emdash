import { deferred } from '@emdash/shared/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectedIssueProviders } from '@core/features/integrations/api/browser/use-connected-issue-providers';
import { invalidateProviderAccountState } from '@core/features/integrations/api/browser/use-provider-accounts';
import {
  IntegrationsProvider,
  useIntegrationsContext,
} from '@core/features/integrations/contributions/browser/integrations-provider';
import type { ProviderAccountsByProvider } from '@core/primitives/provider-accounts/api';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  checkAllConnections: vi.fn(),
  connectIntegration: vi.fn(),
  disconnectIntegration: vi.fn(),
  listProviders: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock('@core/features/issues/api/browser/client', () => ({
  getIssuesClient: async () => ({
    checkAllConnections: mocks.checkAllConnections,
  }),
}));

vi.mock('@core/features/integrations/api/browser/client', () => ({
  getIntegrationsClient: async () => ({
    listProviders: mocks.listProviders,
    connect: mocks.connectIntegration,
    disconnect: mocks.disconnectIntegration,
    listAccounts: mocks.listAccounts,
  }),
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: vi.fn(),
}));

type ProbeState = {
  isCheckingConnections: boolean;
  linearIsMutating: boolean;
  isLoadingAccounts: boolean;
  accountsError: Error | null;
  connectedProviders: string[];
};

type ProbeActions = {
  connectIntegration: (
    integrationId: string,
    input: Record<string, string>
  ) => Promise<{ success: boolean; error?: string }>;
};

function Probe({
  onActions,
  onRender,
}: {
  onActions?: (actions: ProbeActions) => void;
  onRender: (state: ProbeState) => void;
}) {
  const {
    connectIntegration,
    isCheckingConnections,
    isIntegrationMutating,
    isLoadingAccounts,
    accountsError,
  } = useIntegrationsContext();
  const { connectedProviders } = useConnectedIssueProviders();

  onActions?.({ connectIntegration });

  onRender({
    isCheckingConnections,
    linearIsMutating: isIntegrationMutating('linear'),
    isLoadingAccounts,
    accountsError,
    connectedProviders,
  });

  return null;
}

async function flushQueries(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('IntegrationsProvider', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let actions: ProbeActions | null;
  let latest: ProbeState | null;

  beforeEach(() => {
    actions = null;
    latest = null;
    mocks.checkAllConnections.mockReturnValue(new Promise(() => {}));
    mocks.connectIntegration.mockResolvedValue({ success: true });
    mocks.disconnectIntegration.mockResolvedValue({ success: true });
    mocks.listProviders.mockResolvedValue([]);
    mocks.listAccounts.mockResolvedValue({});

    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(async () => {
    await queryClient.cancelQueries();
    await act(async () => {
      await flushQueries();
      root.unmount();
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    queryClient.clear();
    dom.window.close();
  });

  it('does not mark integrations as mutating during the initial live connection check', async () => {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            IntegrationsProvider,
            null,
            React.createElement(Probe, { onRender: (state) => (latest = state) })
          )
        )
      );
    });

    expect(mocks.checkAllConnections).toHaveBeenCalled();
    expect(latest?.isCheckingConnections).toBe(true);
    expect(latest?.linearIsMutating).toBe(false);
  });

  it('recovers provider availability from the account inventory while health checks are pending', async () => {
    const initialInventory = deferred<ProviderAccountsByProvider>();
    const unavailable = new Error('Inventory unavailable');
    mocks.listProviders.mockResolvedValue([
      { id: 'linear', features: ['issues'], issueCapabilities: { requiresRepositoryUrl: false } },
    ]);
    mocks.listAccounts.mockReturnValueOnce(initialInventory.promise).mockResolvedValue({
      linear: [{ providerId: 'linear', accountId: 'work', displayName: 'Work', isDefault: true }],
    });

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            IntegrationsProvider,
            null,
            React.createElement(Probe, { onRender: (state) => (latest = state) })
          )
        )
      );
    });
    expect(latest?.isLoadingAccounts).toBe(true);
    expect(latest?.connectedProviders).toEqual([]);

    await act(async () => {
      initialInventory.reject(unavailable);
      await flushQueries();
    });
    expect(latest?.accountsError).toBe(unavailable);
    expect(latest?.isLoadingAccounts).toBe(false);

    await act(async () => {
      await invalidateProviderAccountState(queryClient);
      await flushQueries();
    });
    expect(latest?.accountsError).toBeNull();
    expect(latest?.connectedProviders).toEqual(['linear']);
    expect(latest?.isCheckingConnections).toBe(true);

    mocks.listAccounts.mockResolvedValue({});
    await act(async () => {
      await invalidateProviderAccountState(queryClient);
      await flushQueries();
    });
    expect(latest?.connectedProviders).toEqual([]);
  });

  it('returns expected connection failures without throwing', async () => {
    mocks.connectIntegration.mockResolvedValue({ success: false, error: 'Invalid token' });

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            IntegrationsProvider,
            null,
            React.createElement(Probe, {
              onActions: (probeActions) => (actions = probeActions),
              onRender: (state) => (latest = state),
            })
          )
        )
      );
    });

    let result: Awaited<ReturnType<ProbeActions['connectIntegration']>> | undefined;
    await act(async () => {
      result = await actions?.connectIntegration('linear', { apiKey: 'bad-key' });
    });

    expect(result).toEqual({ success: false, error: 'Invalid token' });
    expect(latest?.linearIsMutating).toBe(false);
  });

  it('propagates unexpected connection errors', async () => {
    const unexpectedError = new Error('IPC failed');
    mocks.connectIntegration.mockRejectedValue(unexpectedError);

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            IntegrationsProvider,
            null,
            React.createElement(Probe, {
              onActions: (probeActions) => (actions = probeActions),
              onRender: (state) => (latest = state),
            })
          )
        )
      );
    });

    let thrown: unknown;
    await act(async () => {
      try {
        await actions?.connectIntegration('linear', { apiKey: 'key' });
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBe(unexpectedError);
    expect(latest?.linearIsMutating).toBe(false);
  });
});

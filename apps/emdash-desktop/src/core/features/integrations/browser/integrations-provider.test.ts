import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IntegrationsProvider,
  useIntegrationsContext,
} from '@core/features/integrations/api/browser/integrations-provider';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  checkAllConnections: vi.fn(),
  checkConfiguredConnections: vi.fn(),
  connectIntegration: vi.fn(),
  disconnectIntegration: vi.fn(),
  listIntegrations: vi.fn(),
}));

vi.mock('@renderer/lib/runtime/desktop-wire-client', () => ({
  getDesktopWireClient: async () => ({
    issues: {
      checkAllConnections: mocks.checkAllConnections,
      checkConfiguredConnections: mocks.checkConfiguredConnections,
    },
    integrations: {
      list: mocks.listIntegrations,
      connect: mocks.connectIntegration,
      disconnect: mocks.disconnectIntegration,
    },
  }),
}));

type ProbeState = {
  isCheckingConnections: boolean;
  linearIsMutating: boolean;
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
  const { connectIntegration, isCheckingConnections, isIntegrationMutating } =
    useIntegrationsContext();

  onActions?.({ connectIntegration });

  onRender({
    isCheckingConnections,
    linearIsMutating: isIntegrationMutating('linear'),
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
    mocks.checkConfiguredConnections.mockResolvedValue({});
    mocks.connectIntegration.mockResolvedValue({ success: true });
    mocks.disconnectIntegration.mockResolvedValue({ success: true });
    mocks.listIntegrations.mockResolvedValue([]);

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

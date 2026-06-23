import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsProvider, useIntegrationsContext } from './integrations-provider';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  checkAllConnections: vi.fn(),
  checkConfiguredConnections: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    issues: {
      checkAllConnections: mocks.checkAllConnections,
      checkConfiguredConnections: mocks.checkConfiguredConnections,
    },
    linear: { saveToken: vi.fn(), clearToken: vi.fn() },
    jira: { saveCredentials: vi.fn(), clearCredentials: vi.fn() },
    gitlab: { saveCredentials: vi.fn(), clearCredentials: vi.fn() },
    plain: { saveToken: vi.fn(), clearToken: vi.fn() },
    forgejo: { saveCredentials: vi.fn(), clearCredentials: vi.fn() },
    featurebase: { saveToken: vi.fn(), clearToken: vi.fn() },
    asana: { saveToken: vi.fn(), clearToken: vi.fn() },
    monday: { saveCredentials: vi.fn(), clearCredentials: vi.fn() },
    trello: { saveCredentials: vi.fn(), clearCredentials: vi.fn() },
  },
}));

type ProbeState = {
  isCheckingConnections: boolean;
  linearIsMutating: boolean;
};

function Probe({ onRender }: { onRender: (state: ProbeState) => void }) {
  const { isCheckingConnections, providers } = useIntegrationsContext();

  onRender({
    isCheckingConnections,
    linearIsMutating: providers.linear.isMutating,
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
  let latest: ProbeState | null;

  beforeEach(() => {
    latest = null;
    mocks.checkAllConnections.mockReturnValue(new Promise(() => {}));
    mocks.checkConfiguredConnections.mockResolvedValue({});

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

  it('does not mark providers as mutating during the initial live connection check', async () => {
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
});

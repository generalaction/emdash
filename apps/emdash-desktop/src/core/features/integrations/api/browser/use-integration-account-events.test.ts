import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIntegrationAccountEvents } from './use-integration-account-events';

const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('./client', () => ({
  getIntegrationsClient: async () => ({ events: { subscribe: mocks.subscribe } }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('shared integration account events', () => {
  it.each(['github', 'linear', 'gap'])(
    'refreshes inventory and dependent issue queries after %s changes without a GitHub listener',
    async (providerId) => {
      const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('window', dom.window);
      vi.stubGlobal('document', dom.window.document);
      const container = dom.window.document.getElementById('root')!;
      const root = createRoot(container);
      const queryClient = new QueryClient();
      const unsubscribe = vi.fn();
      mocks.subscribe.mockResolvedValue(unsubscribe);
      const queryKeys = [
        ['integrations:accounts'],
        ['issues:connection-status'],
        ['issues:initial', 'linear', 'project'],
      ];
      for (const queryKey of queryKeys) queryClient.setQueryData(queryKey, {});
      queryClient.setQueryData(['unrelated'], {});
      function Probe() {
        useIntegrationAccountEvents();
        return null;
      }

      try {
        await act(async () => {
          root.render(
            React.createElement(
              QueryClientProvider,
              { client: queryClient },
              React.createElement(Probe)
            )
          );
        });
        const handlers = mocks.subscribe.mock.calls[0]?.[1] as {
          onEvent: (event: { type: 'accounts-changed'; providerId: string }) => void;
          onGap: () => void;
        };
        await act(async () => {
          if (providerId === 'gap') handlers.onGap();
          else handlers.onEvent({ type: 'accounts-changed', providerId });
        });
        for (const queryKey of queryKeys) {
          expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
        }
        expect(queryClient.getQueryState(['unrelated'])?.isInvalidated).toBe(false);
      } finally {
        await act(async () => root.unmount());
        queryClient.clear();
        dom.window.close();
      }
      expect(unsubscribe).toHaveBeenCalledOnce();
    }
  );
});

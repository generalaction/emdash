import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnectedIssueProviders } from './use-connected-issue-providers';

const mocks = vi.hoisted(() => ({ context: vi.fn(), settings: vi.fn() }));
vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: mocks.context,
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: mocks.settings,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('project issue provider availability', () => {
  it.each([true, false])(
    'excludes an explicitly disabled provider even with saved accounts (configured=%s)',
    async (configured) => {
      mocks.context.mockReturnValue({
        integrations: [
          {
            id: 'linear',
            features: ['issues'],
            issueCapabilities: { requiresRepositoryUrl: false },
          },
        ],
        integrationAccounts: configured ? { linear: [{ accountId: 'a' }] } : {},
        isLoadingAccounts: false,
      });
      mocks.settings.mockReturnValue({
        durableDomains: {
          integrationAccounts: { stored: { linear: { kind: 'none' } } },
        },
      });
      const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('window', dom.window);
      vi.stubGlobal('document', dom.window.document);
      const container = dom.window.document.getElementById('root')!;
      const root = createRoot(container);
      let result: ReturnType<typeof useConnectedIssueProviders> | undefined;
      function Probe() {
        result = useConnectedIssueProviders({ projectId: 'project' });
        return null;
      }
      try {
        await act(async () => root.render(React.createElement(Probe)));
        expect(result?.connectedProviders).toEqual([]);
        expect(result?.isProviderUsable('linear')).toBe(false);
        expect(result?.hasAnyIssueIntegration).toBe(false);
      } finally {
        await act(async () => root.unmount());
        dom.window.close();
      }
    }
  );

  it('exposes inventory failure when no provider list could be loaded', async () => {
    mocks.context.mockReturnValue({
      integrations: [],
      integrationAccounts: {},
      isLoadingAccounts: false,
      accountsError: new Error('Accounts could not be loaded'),
    });
    const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    function Probe() {
      const result = useConnectedIssueProviders();
      return React.createElement('span', {}, result.error);
    }
    try {
      await act(async () => root.render(React.createElement(Probe)));
      expect(container.textContent).toBe('Accounts could not be loaded');
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it.each([true, false])(
    'keeps a project account reachable when the global default fails (configured=%s)',
    async (configured) => {
      mocks.context.mockReturnValue({
        integrations: [
          {
            id: 'linear',
            features: ['issues'],
            issueCapabilities: { requiresRepositoryUrl: false },
          },
        ],
        integrationAccounts: configured ? { linear: [{ accountId: 'a' }, { accountId: 'b' }] } : {},
        connectionStatus: { linear: { connected: false, error: 'Expired default token' } },
        isLoadingAccounts: false,
      });
      mocks.settings.mockReturnValue({
        durableDomains: {
          integrationAccounts: { stored: { linear: { kind: 'account', accountId: 'b' } } },
        },
      });
      const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('window', dom.window);
      vi.stubGlobal('document', dom.window.document);
      const container = dom.window.document.getElementById('root')!;
      const root = createRoot(container);
      function Probe() {
        const result = useConnectedIssueProviders({ projectId: 'project' });
        return React.createElement('span', {}, result.connectedProviders.join(','));
      }
      try {
        await act(async () => root.render(React.createElement(Probe)));
        expect(container.textContent).toBe('linear');
      } finally {
        await act(async () => root.unmount());
        dom.window.close();
      }
    }
  );
});

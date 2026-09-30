import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueSelector } from './issue-selector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  useIssueSearch: vi.fn(),
}));

vi.mock('./useIssueSearch', () => ({
  useIssueSearch: mocks.useIssueSearch,
}));

vi.mock('./use-linked-issue-urls', () => ({
  getLinkedIssueMap: () => new Map(),
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  openExternal: vi.fn(),
}));

vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => {
  const integrations = [
    {
      id: 'github',
      name: 'GitHub',
      features: ['issues'],
    },
  ];
  return {
    useIntegrationsContext: () => ({
      integrations,
      integrationById: {
        github: integrations[0],
      },
    }),
  };
});

vi.mock('@emdash/ui/react/primitives', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Select: {
      Root: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Content: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Item: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Trigger: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
    },
    Tooltip: {
      Root: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Content: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Trigger: ({ render }: { render: React.ReactElement }) => render,
    },
    Combobox: {
      Root: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Content: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Empty: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', { 'data-testid': 'empty' }, children),
      Input: () => React.createElement('input', {}),
      Item: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      List: () => React.createElement('div', {}),
      Trigger: ({ render }: { render: React.ReactElement }) => render,
      Value: ({
        children,
        placeholder,
      }: {
        children?: React.ReactNode;
        placeholder?: React.ReactNode;
      }) => React.createElement('div', {}, children ?? placeholder),
    },
  };
});

vi.mock('@emdash/ui/react/components', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    InlineMarkdown: ({ content }: { content: string }) => React.createElement('span', {}, content),
  };
});

vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: vi.fn() }),
}));

vi.mock('@core/features/integrations/contributions/browser/account-state', async () => {
  const React = await import('react');
  return {
    ProviderAccountStateEmpty: ({ state }: { state: { kind: string; message?: string } }) =>
      React.createElement(
        'div',
        { 'data-testid': `account-state-${state.kind}` },
        state.message ?? ''
      ),
  };
});

vi.mock('@core/features/conversations/browser/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));

describe('IssueSelector', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  function issueSearchResult(overrides: Record<string, unknown> = {}) {
    return {
      issues: [],
      error: null,
      accountUnavailable: null,
      issueProvider: 'github',
      hasAnyIntegration: true,
      isProviderLoading: false,
      isProviderDisabled: () => false,
      connectedProviderCount: 1,
      handleSetSearchTerm: vi.fn(),
      setSelectedIssueProvider: vi.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    mocks.useIssueSearch.mockReturnValue(
      issueSearchResult({
        error:
          'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
      })
    );

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('shows inventory failure instead of asking an already configured user to connect', async () => {
    mocks.useIssueSearch.mockReturnValue(
      issueSearchResult({
        hasAnyIntegration: false,
        issueProvider: null,
        error: 'Failed to load integration accounts',
      })
    );
    await renderSelector();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Failed to load integration accounts'
    );
    expect(container.textContent).not.toContain('Connect an integration');
  });

  it('shows loading before deciding there are no configured integrations', async () => {
    mocks.useIssueSearch.mockReturnValue(
      issueSearchResult({ hasAnyIntegration: false, issueProvider: null, isProviderLoading: true })
    );
    await renderSelector();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Loading integration accounts'
    );
  });

  it('shows issue search errors instead of the empty issues message', async () => {
    await renderSelector();

    expect(container.textContent).toContain(
      'acme/repo on github.com was not found, or the selected GitHub account does not have access.'
    );
    expect(container.textContent).not.toContain('No issues found');
  });

  async function renderSelector() {
    await act(async () => {
      root.render(
        React.createElement(IssueSelector, {
          value: null,
          onValueChange: vi.fn(),
          repositoryUrl: 'https://github.com/acme/repo',
          projectId: 'project-1',
        })
      );
    });
  }

  it('renders explicit none as the quiet disabled state, not an error', async () => {
    mocks.useIssueSearch.mockReturnValue(
      issueSearchResult({
        accountUnavailable: {
          type: 'account_unavailable',
          provenance: { kind: 'set' },
          accountsConnected: true,
          message: 'GitHub is disabled for this project.',
        },
      })
    );

    await renderSelector();

    const empty = container.querySelector('[data-testid="empty"]');
    expect(empty?.querySelector('[data-testid="account-state-disabled"]')).not.toBeNull();
    expect(empty?.textContent).toContain('GitHub is disabled for this project.');
    expect(empty?.querySelector('.text-foreground-error')).toBeNull();
  });

  it('renders the connect state when inference finds nothing and no accounts exist', async () => {
    mocks.useIssueSearch.mockReturnValue(
      issueSearchResult({
        accountUnavailable: {
          type: 'account_unavailable',
          provenance: { kind: 'inferred', from: 'no host-matching account' },
          accountsConnected: false,
          message: 'Connect a GitHub account to get started.',
        },
      })
    );

    await renderSelector();

    expect(container.querySelector('[data-testid="account-state-connect"]')).not.toBeNull();
    expect(container.textContent).toContain('Connect a GitHub account to get started.');
  });

  it('fails closed on an unresolvable pin', async () => {
    mocks.useIssueSearch.mockReturnValue(
      issueSearchResult({
        accountUnavailable: {
          type: 'account_unavailable',
          provenance: { kind: 'unresolvable' },
          accountsConnected: true,
          message: 'The selected GitHub account is no longer connected.',
        },
      })
    );

    await renderSelector();

    expect(container.querySelector('[data-testid="account-state-unresolvable"]')).not.toBeNull();
    expect(container.textContent).toContain('The selected GitHub account is no longer connected.');
  });

  it.each([
    ['linear', { kind: 'set' }, 'Linear is disabled for this project.'],
    ['jira', { kind: 'unresolvable' }, 'The selected Jira account is no longer connected.'],
  ])(
    'reports unavailable %s accounts using that integration name',
    async (provider, provenance, message) => {
      mocks.useIssueSearch.mockReturnValue(
        issueSearchResult({
          issueProvider: provider,
          accountUnavailable: {
            type: 'account_unavailable',
            provenance,
            accountsConnected: true,
            message,
          },
        })
      );
      await renderSelector();
      expect(container.textContent).toContain(message);
      expect(container.textContent).not.toContain('GitHub');
    }
  );
});

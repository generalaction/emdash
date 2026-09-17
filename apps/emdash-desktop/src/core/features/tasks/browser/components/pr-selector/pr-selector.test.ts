import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequest, SyncState } from '@core/services/pull-requests/api';
import { PrSelector } from './pr-selector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  listPullRequests: vi.fn(),
  refreshRepository: vi.fn(),
  useProjectAccount: vi.fn(),
  useAccounts: vi.fn(),
  syncState: vi.fn(),
}));

vi.mock('@core/primitives/wire/browser/use-remote-model-state', () => ({
  useRemoteModelState: () => ({ value: mocks.syncState(), isLoading: false }),
}));

vi.mock('@core/services/pull-requests/api/client', () => ({
  getPullRequestsRuntimeClient: async () => ({
    listPullRequests: mocks.listPullRequests,
    refreshRepository: mocks.refreshRepository,
  }),
}));

vi.mock('@core/features/integrations/api/browser/use-project-account', () => ({
  useProjectAccount: mocks.useProjectAccount,
}));

vi.mock('@core/features/integrations/api/browser/use-provider-accounts', () => ({
  useAccounts: mocks.useAccounts,
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

vi.mock('@core/services/pull-requests/browser/components/pr-status-icon', async () => {
  const React = await import('react');
  return {
    StatusIcon: () => React.createElement('span', { 'data-testid': 'status-icon' }),
  };
});

vi.mock('@emdash/ui/react/primitives', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import('react');

  type SelectContextValue = {
    onValueChange?: (value: string) => void;
  };
  const SelectContext = React.createContext<SelectContextValue>({});
  function MockSelectItem({ children, value }: { children: React.ReactNode; value: string }) {
    const { onValueChange } = React.useContext(SelectContext);
    return React.createElement(
      'button',
      {
        'data-testid': `status-${value}`,
        onClick: () => onValueChange?.(value),
      },
      children
    );
  }

  type ComboboxContextValue = {
    items?: PullRequest[];
    inputValue?: string;
    onInputValueChange?: (value: string, details: { reason: string }) => void;
  };

  const ComboboxContext = React.createContext<ComboboxContextValue>({});
  function MockComboboxInput({
    placeholder,
    rightAddon,
  }: {
    placeholder?: string;
    rightAddon?: React.ReactNode;
  }) {
    const { inputValue, onInputValueChange } = React.useContext(ComboboxContext);
    return React.createElement(
      'div',
      {},
      React.createElement('button', {
        'data-testid': 'search-input',
        placeholder,
        'data-input-value': inputValue ?? '',
        onClick: () => onInputValueChange?.('eng-1463', { reason: 'input' }),
      }),
      rightAddon
    );
  }

  return {
    ...actual,
    Select: {
      Root: ({
        children,
        onValueChange,
      }: {
        children: React.ReactNode;
        onValueChange?: (value: string) => void;
      }) =>
        React.createElement(
          SelectContext.Provider,
          { value: { onValueChange } },
          React.createElement('div', {}, children)
        ),
      Content: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Item: MockSelectItem,
      Trigger: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
    },
    Combobox: {
      Root: ({
        children,
        items,
        inputValue,
        onInputValueChange,
      }: {
        children: React.ReactNode;
        items?: PullRequest[];
        inputValue?: string;
        onInputValueChange?: (value: string, details: { reason: string }) => void;
      }) =>
        React.createElement(
          ComboboxContext.Provider,
          { value: { items, inputValue, onInputValueChange } },
          children
        ),
      Content: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Empty: ({ children }: { children: React.ReactNode }) => {
        const { items } = React.useContext(ComboboxContext);
        return items?.length ? null : React.createElement('div', {}, children);
      },
      Input: MockComboboxInput,
      Item: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      List: ({ children }: { children: React.ReactNode }) => {
        const { items } = React.useContext(ComboboxContext);
        return React.createElement(
          'div',
          {},
          items?.map((item) =>
            typeof children === 'function'
              ? (children as (item: PullRequest) => React.ReactNode)(item)
              : children
          )
        );
      },
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

const PROJECT_ID = 'project-1';
const REPOSITORY_URL = 'https://github.com/acme/repo';

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    url: 'https://github.com/acme/repo/pull/1',
    provider: 'github',
    repositoryUrl: REPOSITORY_URL,
    baseRefName: 'main',
    baseRefOid: 'base-oid',
    headRepositoryUrl: REPOSITORY_URL,
    headRefName: 'feature/search',
    headRefOid: 'head-oid',
    identifier: '#1',
    title: 'Search PR',
    description: null,
    status: 'open',
    isDraft: false,
    additions: null,
    deletions: null,
    changedFiles: null,
    commitCount: null,
    mergeableStatus: null,
    mergeStateStatus: null,
    reviewDecision: null,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
    ...overrides,
  };
}

describe('PrSelector', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listPullRequests.mockResolvedValue({ success: true, data: { prs: [makePr()] } });
    mocks.refreshRepository.mockResolvedValue({ success: true });
    mocks.useProjectAccount.mockReturnValue(null);
    mocks.useAccounts.mockReturnValue({ data: [] });
    mocks.syncState.mockReturnValue({ phase: 'idle', kind: null, revision: 0 } satisfies SyncState);

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('passes debounced input text as the pull request search query', async () => {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(PrSelector, {
            value: null,
            onValueChange: vi.fn(),
            projectId: PROJECT_ID,
            repositoryUrl: REPOSITORY_URL,
          })
        )
      );
    });

    expect(mocks.listPullRequests).toHaveBeenCalledWith(
      expect.objectContaining({ searchQuery: undefined })
    );

    const input = container.querySelector('[data-testid="search-input"]');
    expect(input).not.toBeNull();

    await act(async () => {
      input!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mocks.listPullRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchQuery: 'eng-1463' })
    );
  });

  it('reloads cached selector results on inventory revisions without triggering refresh', async () => {
    mocks.syncState.mockReturnValue({ phase: 'running', kind: 'repository', revision: 0 });
    mocks.listPullRequests.mockResolvedValueOnce({ success: true, data: { prs: [] } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(PrSelector, {
            value: null,
            onValueChange: vi.fn(),
            projectId: PROJECT_ID,
            repositoryUrl: REPOSITORY_URL,
          })
        )
      );
    });
    expect(mocks.listPullRequests).toHaveBeenCalledTimes(1);
    expect(mocks.refreshRepository).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Loading pull requests…');
    mocks.syncState.mockReturnValue({ phase: 'idle', kind: null, revision: 1 });
    await renderSelector();
    expect(mocks.listPullRequests).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(container.textContent).toContain('Search PR'));
    expect(mocks.refreshRepository).not.toHaveBeenCalled();
  });

  it('clears the active search query immediately when the status filter changes', async () => {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(PrSelector, {
            value: null,
            onValueChange: vi.fn(),
            projectId: PROJECT_ID,
            repositoryUrl: REPOSITORY_URL,
          })
        )
      );
    });

    const input = container.querySelector('[data-testid="search-input"]');
    expect(input).not.toBeNull();

    await act(async () => {
      input!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(mocks.listPullRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: { status: 'open' },
        searchQuery: 'eng-1463',
      })
    );

    const closedStatus = container.querySelector('[data-testid="status-not-open"]');
    expect(closedStatus).not.toBeNull();

    await act(async () => {
      closedStatus!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(mocks.listPullRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: { status: 'not-open' },
        searchQuery: undefined,
      })
    );
  });

  it('shows background sync errors instead of the empty pull request message', async () => {
    mocks.syncState.mockReturnValue({
      phase: 'error',
      kind: null,
      error: {
        type: 'github_not_found_or_no_access',
        host: 'github.com',
        message:
          'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
      },
    });
    mocks.listPullRequests.mockResolvedValue({ success: true, data: { prs: [] } });

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(PrSelector, {
            value: null,
            onValueChange: vi.fn(),
            projectId: PROJECT_ID,
            repositoryUrl: REPOSITORY_URL,
          })
        )
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        'acme/repo on github.com was not found, or the selected GitHub account does not have access.'
      );
    });
    expect(container.textContent).not.toContain('No open pull requests');
  });

  it('shows background sync errors above cached pull request results', async () => {
    mocks.syncState.mockReturnValue({
      phase: 'error',
      kind: null,
      error: {
        type: 'sync_failed',
        message: 'GitHub sync failed for this repository.',
      },
    });
    mocks.listPullRequests.mockResolvedValue({ success: true, data: { prs: [makePr()] } });

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(PrSelector, {
            value: null,
            onValueChange: vi.fn(),
            projectId: PROJECT_ID,
            repositoryUrl: REPOSITORY_URL,
          })
        )
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('GitHub sync failed for this repository.');
    });
    expect(container.textContent).toContain('Sync failed');
    expect(container.textContent).toContain('Search PR');
    expect(container.querySelector('[data-slot="list-popover-card"]')).not.toBeNull();
    expect(container.querySelector('[data-status="destructive"]')).not.toBeNull();
    expect(container.textContent).not.toContain('No open pull requests');
  });

  function renderSelector() {
    return act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(PrSelector, {
            value: null,
            onValueChange: vi.fn(),
            projectId: PROJECT_ID,
            repositoryUrl: REPOSITORY_URL,
          })
        )
      );
    });
  }

  it.each([
    { name: 'settings are loading', resolution: null, accounts: [] },
    {
      name: 'accounts are loading',
      resolution: { value: null, provenance: { kind: 'set' } },
      accounts: undefined,
    },
    {
      name: 'an account is selected',
      resolution: { value: { accountId: 'selected' }, provenance: { kind: 'set' } },
      accounts: [{ accountId: 'selected' }],
    },
    {
      name: 'inference is silent with connected accounts',
      resolution: {
        value: null,
        provenance: { kind: 'inferred', from: 'no host-matching account' },
      },
      accounts: [{ accountId: 'other-host' }],
    },
  ])('keeps the normal selector when $name', async ({ resolution, accounts }) => {
    mocks.useProjectAccount.mockReturnValue(resolution);
    mocks.useAccounts.mockReturnValue({ data: accounts });

    await renderSelector();

    expect(container.querySelector('[data-testid^="account-state-"]')).toBeNull();
    expect(mocks.listPullRequests).toHaveBeenCalled();
    expect(mocks.useAccounts).toHaveBeenCalledWith('github');
  });

  it('renders a quiet disabled state and does not sync when GitHub is explicitly off', async () => {
    mocks.useProjectAccount.mockReturnValue({ value: null, provenance: { kind: 'set' } });
    mocks.listPullRequests.mockResolvedValue({ success: true, data: { prs: [] } });

    await renderSelector();

    expect(container.querySelector('[data-testid="account-state-disabled"]')).not.toBeNull();
    expect(container.textContent).toContain('GitHub is disabled for this project.');
    expect(container.querySelector('[data-status="destructive"]')).toBeNull();
    expect(mocks.refreshRepository).not.toHaveBeenCalled();
    expect(mocks.listPullRequests).not.toHaveBeenCalled();
  });

  it('fails closed without syncing when the pinned account is unresolvable', async () => {
    mocks.useProjectAccount.mockReturnValue({ value: null, provenance: { kind: 'unresolvable' } });

    await renderSelector();

    expect(container.querySelector('[data-testid="account-state-unresolvable"]')).not.toBeNull();
    expect(container.textContent).toContain('The selected GitHub account is no longer connected.');
    expect(mocks.refreshRepository).not.toHaveBeenCalled();
    expect(mocks.listPullRequests).not.toHaveBeenCalled();
  });

  it('renders the connect state when no GitHub accounts are connected', async () => {
    mocks.useProjectAccount.mockReturnValue({
      value: null,
      provenance: { kind: 'inferred', from: 'no host-matching account' },
    });

    await renderSelector();

    expect(container.querySelector('[data-testid="account-state-connect"]')).not.toBeNull();
    expect(container.textContent).toContain('Connect a GitHub account to get started.');
    expect(mocks.refreshRepository).not.toHaveBeenCalled();
  });
});

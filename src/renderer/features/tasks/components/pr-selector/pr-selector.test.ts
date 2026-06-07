import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import { PrSelector } from './pr-selector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  listPullRequests: vi.fn(),
  syncPullRequests: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    pullRequests: {
      listPullRequests: mocks.listPullRequests,
      syncPullRequests: mocks.syncPullRequests,
    },
  },
}));

vi.mock('@renderer/lib/components/pr-status-icon', async () => {
  const React = await import('react');
  return {
    StatusIcon: () => React.createElement('span', { 'data-testid': 'status-icon' }),
  };
});

vi.mock('@renderer/lib/ui/select', async () => {
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

  return {
    Select: ({
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
    SelectContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    SelectItem: MockSelectItem,
    SelectTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
  };
});

vi.mock('@renderer/lib/ui/combobox', async () => {
  const React = await import('react');

  type ComboboxContextValue = {
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
    Combobox: ({
      children,
      inputValue,
      onInputValueChange,
    }: {
      children: React.ReactNode;
      inputValue?: string;
      onInputValueChange?: (value: string, details: { reason: string }) => void;
    }) =>
      React.createElement(
        ComboboxContext.Provider,
        { value: { inputValue, onInputValueChange } },
        children
      ),
    ComboboxContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    ComboboxEmpty: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    ComboboxInput: MockComboboxInput,
    ComboboxItem: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    ComboboxList: () => React.createElement('div', {}),
    ComboboxTrigger: ({ render }: { render: React.ReactElement }) => render,
    ComboboxValue: ({
      children,
      placeholder,
    }: {
      children?: React.ReactNode;
      placeholder?: React.ReactNode;
    }) => React.createElement('div', {}, children ?? placeholder),
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
    mocks.syncPullRequests.mockResolvedValue({ success: true });

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
      PROJECT_ID,
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
      PROJECT_ID,
      expect.objectContaining({ searchQuery: 'eng-1463' })
    );
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
      PROJECT_ID,
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
      PROJECT_ID,
      expect.objectContaining({
        filters: { status: 'not-open' },
        searchQuery: undefined,
      })
    );
  });
});

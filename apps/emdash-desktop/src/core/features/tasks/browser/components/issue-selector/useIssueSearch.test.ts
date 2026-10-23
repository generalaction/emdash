import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useIssueSearch } from './useIssueSearch';

const mocks = vi.hoisted(() => ({
  selectedProvider: null as string | null,
  connectedProviders: ['github', 'gitlab'] as string[],
}));

vi.mock('@core/features/integrations/api/browser/use-connected-issue-providers', () => ({
  useConnectedIssueProviders: () => ({
    connectedProviders: mocks.connectedProviders,
    hasAnyIssueIntegration: true,
    isProviderUsable: (provider: string) => mocks.connectedProviders.includes(provider),
    isCheckingConnections: false,
    error: null,
  }),
}));
vi.mock('@core/features/integrations/api/browser/use-issues', () => ({
  useIssues: () => ({
    issues: [],
    error: null,
    accountUnavailable: null,
    isLoading: false,
    isSearching: false,
    setSearchTerm: vi.fn(),
  }),
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectViewStore: () => ({
    selectedIssueProvider: mocks.selectedProvider,
    setSelectedIssueProvider: vi.fn(),
  }),
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => ({ providerRepository: { provider: 'gitlab' } }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.selectedProvider = null;
  mocks.connectedProviders = ['github', 'gitlab'];
});

it.each([
  [null, ['github', 'gitlab'], 'gitlab'],
  ['github', ['gitlab'], 'gitlab'],
  ['linear', ['linear', 'gitlab'], 'linear'],
])('selects a compatible provider for %s', async (selected, connected, expected) => {
  mocks.selectedProvider = selected;
  mocks.connectedProviders = connected;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  function Probe() {
    const { issueProvider } = useIssueSearch('https://gitlab.com/group/repo', '', 'project');
    return React.createElement('span', {}, issueProvider);
  }

  try {
    await act(async () => root.render(React.createElement(Probe)));
    expect(container.textContent).toBe(expected);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

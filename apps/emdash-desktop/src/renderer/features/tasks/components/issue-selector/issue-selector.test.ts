import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/ui/combobox', async () => {
  const React = await import('react');
  return {
    Combobox: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    ComboboxContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    ComboboxEmpty: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'empty' }, children),
    ComboboxInput: () => React.createElement('input', {}),
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

vi.mock('@renderer/lib/ui/select', async () => {
  const React = await import('react');
  return {
    Select: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    SelectContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    SelectItem: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    SelectTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
  };
});

vi.mock('@renderer/lib/ui/tooltip', async () => {
  const React = await import('react');
  return {
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    TooltipContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    TooltipTrigger: ({ render }: { render: React.ReactElement }) => render,
  };
});

vi.mock('@renderer/lib/components/inline-markdown', async () => {
  const React = await import('react');
  return {
    InlineMarkdown: ({ children }: { children: React.ReactNode }) =>
      React.createElement('span', {}, children),
  };
});

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => vi.fn(),
}));

describe('IssueSelector', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.useIssueSearch.mockReturnValue({
      issues: [],
      error:
        'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
      issueProvider: 'github',
      hasAnyIntegration: true,
      isProviderLoading: false,
      isProviderDisabled: () => false,
      connectedProviderCount: 1,
      handleSetSearchTerm: vi.fn(),
      setSelectedIssueProvider: vi.fn(),
    });

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

  it('shows issue search errors instead of the empty issues message', async () => {
    const { IssueSelector } = await import('./issue-selector');

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

    expect(container.textContent).toContain(
      'acme/repo on github.com was not found, or the selected GitHub account does not have access.'
    );
    expect(container.textContent).not.toContain('No issues found');
  });
});

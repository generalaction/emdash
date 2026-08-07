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
  useNavigate: () => vi.fn(),
}));

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

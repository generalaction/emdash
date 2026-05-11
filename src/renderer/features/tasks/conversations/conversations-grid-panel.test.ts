import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsGridPanel } from './conversations-grid-panel';

const { paneCalls, ptyCalls, mockState } = vi.hoisted(() => ({
  paneCalls: [] as Array<{ paneId: string; sessionIds: string[] }>,
  ptyCalls: [] as Array<{ sessionId: string }>,
  mockState: {
    provisioned: null as {
      taskView: {
        agentLayoutMode: 'tabs' | 'side-by-side' | 'stacked' | 'tile';
        agentSlots: string[];
        removeConversationFromLayout: (conversationId: string) => void;
      };
      conversations: {
        conversations: Map<
          string,
          {
            data: { providerId: string; title: string };
            session: {
              sessionId: string;
              status: 'disconnected' | 'connecting' | 'ready';
              pty: object | null;
            };
          }
        >;
      };
    } | null,
  },
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1' }),
  useProvisionedTask: () => {
    if (!mockState.provisioned) {
      throw new Error('mockState.provisioned not set');
    }
    return mockState.provisioned;
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/lib/pty/pane-sizing-context', () => ({
  PaneSizingProvider: ({
    paneId,
    sessionIds,
    children,
  }: {
    paneId: string;
    sessionIds: string[];
    children: React.ReactNode;
  }) => {
    paneCalls.push({ paneId, sessionIds });
    return React.createElement('div', { 'data-pane-id': paneId }, children);
  },
}));

vi.mock('@renderer/lib/pty/pty-pane', () => ({
  PtyPane: ({ sessionId }: { sessionId: string }) => {
    ptyCalls.push({ sessionId });
    return React.createElement('div', { 'data-session-id': sessionId }, 'pty');
  },
}));

vi.mock('@renderer/lib/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) =>
    React.createElement('button', null, children),
}));

vi.mock('@renderer/lib/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  ContextMenuTrigger: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('div', { className }, children),
  ContextMenuContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  ContextMenuItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('@renderer/lib/ui/empty-state', () => ({
  EmptyState: ({ label }: { label: string }) => React.createElement('div', null, label),
}));

vi.mock('@renderer/lib/ui/resizable', () => ({
  ResizableHandle: () => React.createElement('div', { 'data-resize-handle': true }),
  ResizablePanel: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('@renderer/lib/components/agent-logo', () => ({
  default: () => React.createElement('div', { 'data-agent-logo': true }),
}));

vi.mock('@renderer/utils/agentConfig', () => ({
  agentConfig: {
    codex: { logo: '', alt: 'Codex', isSvg: false, invertInDark: false },
    claude: { logo: '', alt: 'Claude', isSvg: false, invertInDark: false },
  },
}));

vi.mock('@renderer/utils/utils', () => ({
  cn: (...values: Array<string | undefined | false | null>) => values.filter(Boolean).join(' '),
}));

function makeProvisioned(slots: string[]) {
  return {
    taskView: {
      agentLayoutMode: 'side-by-side' as const,
      agentSlots: slots,
      removeConversationFromLayout: vi.fn(),
    },
    conversations: {
      conversations: new Map(
        slots.map((id, index) => [
          id,
          {
            data: {
              providerId: index % 2 === 0 ? 'codex' : 'claude',
              title: `Conversation ${index + 1}`,
            },
            session: {
              sessionId: `session-${index + 1}`,
              status: 'ready' as const,
              pty: {},
            },
          },
        ])
      ),
    },
  };
}

describe('ConversationsGridPanel pane sizing', () => {
  beforeEach(() => {
    paneCalls.length = 0;
    ptyCalls.length = 0;
  });

  it('creates an independent pane sizing context for each visible conversation cell', () => {
    mockState.provisioned = makeProvisioned(['conversation-1', 'conversation-2']);

    renderToStaticMarkup(React.createElement(ConversationsGridPanel));

    expect(paneCalls).toEqual([
      { paneId: 'agent-cell-conversation-1', sessionIds: ['session-1'] },
      { paneId: 'agent-cell-conversation-2', sessionIds: ['session-2'] },
    ]);
    expect(ptyCalls).toEqual([{ sessionId: 'session-1' }, { sessionId: 'session-2' }]);
  });

  it('does not create a shared grid pane sizing context when no conversations are visible', () => {
    mockState.provisioned = makeProvisioned([]);

    const html = renderToStaticMarkup(React.createElement(ConversationsGridPanel));

    expect(html).toContain('No conversations in layout');
    expect(paneCalls).toEqual([]);
    expect(ptyCalls).toEqual([]);
  });
});

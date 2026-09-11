import * as chatUi from '@emdash/chat-ui';
import '@emdash/chat-ui/style.css';
import type {
  SessionConfigState,
  SessionMcpServer,
  SessionState,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';
import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import '@emdash/ui/style.css';
import {
  client,
  connect,
  createController,
  createWireSessionHub,
  defineContract,
  memoryTransportPair,
} from '@emdash/wire/rpc';
import { cell, expose, flushStateTurn } from '@emdash/wire/state';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { conversationsContract } from '@core/features/conversations/api';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { AcpChatPanel } from '@core/features/conversations/browser/acp/acp-chat-panel';
import { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';

const fixture = vi.hoisted(() => ({
  client: undefined as unknown,
  context: undefined as unknown,
  store: undefined as unknown,
  restored: false,
}));
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => fixture.client,
}));
vi.mock('@core/features/conversations/api/browser/chat/shared-chat-context', () => ({
  getSharedChatContext: () => fixture.context,
}));
vi.mock('@core/features/conversations/api/browser/stores/conversation-registry', () => ({
  conversationRegistry: {
    get: () => ({
      conversations: new Map([
        [
          'startup-diagnostic',
          {
            seen: true,
            data: {
              providerId: 'codex',
              sessionId: fixture.restored ? 'existing-session' : undefined,
            },
          },
        ],
      ]),
    }),
  },
}));
vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    reportError: vi.fn(),
    subject: () => ({
      ready: Promise.resolve(),
      release: async () => {},
      handle: () => ({
        value: { version: '1', text: '', attachments: [] },
        autoPersist: () => () => {},
      }),
    }),
  }),
}));
vi.mock('@core/primitives/workbench-shell/browser/tabs/pane-context', () => ({
  usePaneContext: () => ({
    pane: {
      resolvedTabs: [{ isActive: true, kind: 'acp-chat', resource: { store: fixture.store } }],
    },
  }),
}));
vi.mock('@core/features/agents/api/browser/use-agents', () => ({
  useAgents: () => ({ data: [] }),
}));
vi.mock('@core/features/agents/api/browser/use-agent-metadata', () => ({
  useAgentMetadata: () => ({ data: [] }),
}));
vi.mock('@core/features/agents/contributions/browser/agent-icon', () => ({
  AgentIcon: () => null,
}));
vi.mock('@core/features/integrations/api/browser/use-connected-issue-providers', () => ({
  useConnectedIssueProviders: () => ({ connectedProviders: [], isProviderUsable: () => false }),
}));
vi.mock('@core/features/integrations/contributions/browser/integration-icon', () => ({
  IntegrationIcon: () => null,
}));
vi.mock('@core/features/library/api/browser/prompts/use-prompt-library', () => ({
  usePromptLibrary: () => ({ value: [] }),
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectHostAccess: () => undefined,
  getProjectSshConnectionId: () => undefined,
  getProjectStore: () => undefined,
  getProjectViewStore: () => undefined,
  projectData: () => undefined,
}));
vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  asProvisioned: () => undefined,
  getTaskStore: () => undefined,
  getRegisteredTaskData: () => undefined,
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => undefined,
}));
vi.mock('@core/manifests/browser/project-availability-ui', () => ({
  projectAvailabilityUi: { getLiveActionDisabledReason: () => undefined },
}));
vi.mock('@core/manifests/browser/modal-api', () => ({ openModal: vi.fn() }));
vi.mock('@core/features/conversations/browser/acp/transcript-file-commands', () => ({
  createTranscriptFileCommands: () => ({}),
}));

it.each([
  { restored: false, populated: false },
  { restored: true, populated: false },
  { restored: true, populated: true },
  { restored: false, populated: false, controls: false },
])('keeps startup layout stable (%j)', async ({ restored, populated, controls = true }) => {
  await page.viewport(1100, 800);
  fixture.restored = restored;
  installChatUiRuntime(chatUi);
  const context = chatUi.createChatContext();
  fixture.context = context;
  const state = cell<SessionState>({
    lifecycle: 'closed',
    suspended: true,
    activeTurnId: null,
    pendingPermissions: [],
    lastStopReason: null,
    lastTurnErrored: false,
    queuedPrompts: [],
    agentTurnActive: false,
    backgroundAgentCount: 0,
    isGenerating: false,
    canSubmit: true,
    canCancel: false,
  });
  const config = cell<SessionConfigState>({
    modelOptions: null,
    efforts: null,
    modeOptions: null,
    collaborationModeOptions: null,
    availableCommands: [],
  });
  const mcpServers = cell<SessionMcpServer[]>([{ name: 'docs', transport: 'http' }]);
  const contract = defineContract({
    acp: defineContract({
      attach: conversationsContract.acp.attach,
      session: conversationsContract.acp.session,
      loadHistory: conversationsContract.acp.loadHistory,
    }),
  });
  const activeTurn = cell<TranscriptTurn | null>(null);
  const session = expose(contract.acp.session, {
    state,
    config,
    activeTurn,
    usage: cell(null),
    plan: cell(null),
    agents: cell([]),
    terminals: cell([]),
    mcpServers,
  });
  const historyGate = deferred<void>();
  const userTurn: TranscriptTurn = {
    id: 'user-turn',
    seq: 0,
    initiator: 'user',
    items: [{ kind: 'message', id: 'user-message', seq: 0, role: 'user', text: 'Hello' }],
  };
  const loadHistory = vi.fn(async () => {
    await historyGate.promise;
    return ok({ turns: populated ? [userTurn] : [], nextCursor: null });
  });
  const hub = createWireSessionHub(
    createController(
      contract,
      { acp: { attach: async () => ok(undefined), session, loadHistory } },
      { validate: 'full' }
    )
  );
  const pair = memoryTransportPair();
  hub.open('startup-layout', pair.right);
  const connection = connect(pair.left);
  fixture.client = client(contract, connection);
  const store = new AcpChatStore('startup-diagnostic', 'project-1', 'task-1');
  fixture.store = store;
  const parent = document.createElement('div');
  parent.style.cssText = 'width:1000px;height:700px;position:relative;font-family:system-ui';
  parent.className = 'emlight';
  const css = document.createElement('style');
  css.textContent =
    '.relative {position:relative}.absolute {position:absolute}.h-full {height:100%}.overflow-hidden {overflow:hidden}.inset-0 {inset:0}';
  document.head.append(css);
  document.body.append(parent);
  const root = createRoot(parent);
  const editor = () => parent.querySelector<HTMLElement>('[contenteditable="true"]');
  const editorY = () => editor()!.getBoundingClientRect().top - parent.getBoundingClientRect().top;
  let initialEditorY: number | undefined;
  try {
    await act(async () => root.render(<AcpChatPanel />));
    if (!restored) {
      await vi.waitFor(() => expect(editor()).not.toBeNull());
      expect(editorY()).toBeLessThan(450);
      initialEditorY = editorY();
      expect(parent.textContent).toContain('What are we building today?');
    }
    store.bootstrap();
    await vi.waitFor(() => expect(loadHistory).toHaveBeenCalledOnce());
    expect(store.historyLoading).toBe(true);
    if (restored) {
      expect(editor()).toBeNull();
      expect(parent.textContent).toContain('Loading chat...');
    } else {
      expect(store.isEmpty).toBe(true);
      expect(editorY()).toBeLessThan(450);
      expect(parent.textContent).not.toContain('Loading controls');
      expect(parent.querySelector('[data-slot="combobox-trigger"]')).toBeNull();
    }

    if (controls)
      config.set({
        modelOptions: {
          configId: 'model',
          selected: 'test-model',
          available: [{ id: 'test-model', name: 'Diagnostic Model' }],
        },
        efforts: null,
        modeOptions: {
          configId: 'mode',
          selected: 'full',
          available: [{ id: 'full', name: 'Full access' }],
        },
        collaborationModeOptions: null,
        availableCommands: [],
      });
    flushStateTurn();
    if (!restored && controls) {
      await vi.waitFor(() => expect(parent.textContent).toContain('Diagnostic Model'));
      expect(editorY()).toBeLessThan(450);
    }
    historyGate.resolve();
    await vi.waitFor(() => expect(store.historyLoading).toBe(false));
    await vi.waitFor(() => expect(store.isEmpty).toBe(!populated));
    await vi.waitFor(() => expect(editor()).not.toBeNull());
    if (populated) expect(editorY()).toBeGreaterThan(500);
    else expect(editorY()).toBeLessThan(450);
    if (initialEditorY !== undefined) expect(editorY()).toBeCloseTo(initialEditorY, 1);
    const originalEditor = editor();
    const originalY = editorY();
    const mcpTrigger = parent.querySelector<HTMLElement>('[aria-label="1 session MCP server"]')!;
    const mcpWidth = mcpTrigger.getBoundingClientRect().width;
    const mcpColor = getComputedStyle(mcpTrigger).color;
    mcpServers.set([{ name: 'docs', transport: 'http', startupError: 'Connection refused' }]);
    flushStateTurn();
    await vi.waitFor(() =>
      expect(
        parent.querySelector('[aria-label="1 session MCP server, 1 startup failure"]')
      ).not.toBeNull()
    );
    expect(store.isEmpty).toBe(!populated);
    expect(editor()).toBe(originalEditor);
    expect(editorY()).toBeCloseTo(originalY, 1);
    expect(mcpTrigger.getBoundingClientRect().width).toBeCloseTo(mcpWidth, 1);
    expect(getComputedStyle(mcpTrigger).color).not.toBe(mcpColor);
    expect(getComputedStyle(mcpTrigger.querySelector('svg')!).color).toBe(
      getComputedStyle(mcpTrigger).color
    );
    expect(mcpTrigger.querySelectorAll('svg')).toHaveLength(1);
    if (populated) expect(editorY()).toBeGreaterThan(500);
    else expect(editorY()).toBeLessThan(450);
    expect(parent.textContent).not.toContain('Loading controls');

    if (!restored) {
      await page.getByRole('button', { name: '1 session MCP server, 1 startup failure' }).click();
      expect(document.body.textContent).not.toContain('Connection refused');
      await page.getByRole('button', { name: 'docs startup error' }).hover();
      await vi.waitFor(() => expect(document.body.textContent).toContain('Connection refused'));
      await page.getByRole('tooltip').hover();
      expect(page.getByRole('tooltip').element().textContent).toBe('Connection refused');
      const info = page
        .getByRole('button', { name: 'docs startup error' })
        .element() as HTMLElement;
      const row = info.parentElement!.parentElement!;
      const nameBounds = row.querySelector('span')!.getBoundingClientRect();
      const infoBounds = info.getBoundingClientRect();
      const transportBounds = row.querySelector('[data-failed]')!.getBoundingClientRect();
      expect(infoBounds.left).toBeGreaterThanOrEqual(nameBounds.right);
      expect(infoBounds.left - nameBounds.right).toBeLessThanOrEqual(8);
      expect(transportBounds.left).toBeGreaterThanOrEqual(infoBounds.right);
      expect(getComputedStyle(row.querySelector('[data-failed]')!).color).toBe(
        getComputedStyle(row.querySelector('span')!).color
      );
      await userEvent.keyboard('{Escape}');
      await userEvent.keyboard('{Tab}');
      info.focus();
      await vi.waitFor(() =>
        expect(page.getByRole('tooltip').element().textContent).toBe('Connection refused')
      );
      await page.getByRole('button', { name: '1 session MCP server, 1 startup failure' }).click();
    }

    if (!populated) {
      activeTurn.set(userTurn);
      flushStateTurn();
      await vi.waitFor(() => expect(store.isEmpty).toBe(false));
      await vi.waitFor(() => expect(editorY()).toBeGreaterThan(500));
      expect(parent.textContent).not.toContain('What are we building today?');
      expect(editor()).toBe(originalEditor);
    }
  } finally {
    historyGate.resolve();
    await act(async () => root.unmount());
    store.dispose();
    connection.dispose();
    await hub.dispose();
    await session.dispose();
    context.dispose();
    parent.remove();
    css.remove();
  }
});

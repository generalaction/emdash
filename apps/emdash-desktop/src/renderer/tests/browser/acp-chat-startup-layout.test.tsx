import * as chatUi from '@emdash/chat-ui';
import '@emdash/chat-ui/style.css';
import type {
  SessionConfigState,
  SessionMcpServer,
  SessionState,
  SessionUsage,
  PlanState,
  TerminalState,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';
import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import '@emdash/ui/style.css';
import type { PromptEditorModel } from '@emdash/ui/react/components';
import {
  client,
  connect,
  createController,
  createWireSessionHub,
  defineContract,
  memoryTransportPair,
} from '@emdash/wire/rpc';
import { cell, expose, flushStateTurn } from '@emdash/wire/state';
import { observable, runInAction } from 'mobx';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { conversationsContract } from '@core/features/conversations/api';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { AcpChatPanel } from '@core/features/conversations/browser/acp/acp-chat-panel';
import { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';
import { openModal } from '@core/manifests/browser/modal-api';
import type { AgentMetadata } from '@core/primitives/agents/api';

const fixture = vi.hoisted(() => ({
  client: undefined as unknown,
  context: undefined as unknown,
  store: undefined as unknown,
  restored: false,
  providerId: 'codex',
  agents: [] as Array<
    Pick<AgentMetadata, 'id' | 'name'> & {
      capabilities: Pick<AgentMetadata['capabilities'], 'auth'>;
    }
  >,
  pane: undefined as { readonly resolvedTabs: unknown[] } | undefined,
}));
beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
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
              providerId: fixture.providerId,
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
    pane: fixture.pane ?? {
      resolvedTabs: [{ isActive: true, kind: 'acp-chat', resource: { store: fixture.store } }],
    },
  }),
}));
vi.mock('@core/features/agents/api/browser/use-agents', () => ({
  useAgents: () => ({ data: fixture.agents }),
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

it('starts a fresh session in place when the saved provider session is missing', async () => {
  await page.viewport(1100, 800);
  installChatUiRuntime(chatUi);
  const context = chatUi.createChatContext();
  fixture.context = context;
  vi.mocked(openModal).mockClear();
  const store = new AcpChatStore('startup-diagnostic', 'project-1', 'task-1');
  const retry = vi.spyOn(store, 'retry').mockImplementation(() => {});
  fixture.store = store;
  runInAction(() => {
    store.historyLoading = false;
    store.loadError = {
      kind: 'session_not_found',
      message: 'The agent could not find this saved conversation.',
    };
  });
  const parent = document.createElement('div');
  parent.style.cssText = 'width:1000px;height:700px;position:relative;font-family:system-ui';
  parent.className = 'emlight';
  document.body.append(parent);
  const root = createRoot(parent);
  try {
    await act(async () => root.render(<AcpChatPanel />));
    await expect.element(page.getByRole('button', { name: 'Start fresh session' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await act(async () => page.getByRole('button', { name: 'Retry', exact: true }).click());
    expect(retry).toHaveBeenCalledOnce();
    expect(vi.mocked(openModal)).not.toHaveBeenCalled();

    await act(async () => page.getByRole('button', { name: 'Start fresh session' }).click());
    expect(retry).toHaveBeenLastCalledWith({ mode: 'fresh' });
    expect(store.conversationId).toBe('startup-diagnostic');
    expect(openModal).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    store.dispose();
    context.dispose();
    parent.remove();
    vi.mocked(openModal).mockReset();
  }
});

it.each([false, true])(
  'restores the sign-in screen with retained history=%s',
  async (populated) => {
    await page.viewport(1100, 800);
    fixture.restored = populated;
    fixture.providerId = 'droid';
    // Droid receives this fallback CLI login method from the host's metadata builder.
    fixture.agents = [
      {
        id: 'droid',
        name: 'Droid',
        capabilities: {
          auth: {
            kind: 'supported',
            methods: [
              {
                kind: 'cli-login',
                id: 'cli-login',
                name: 'Sign in with Droid',
                args: [],
                description: 'Open droid in a terminal and complete the provider sign-in flow.',
              },
            ],
          },
        },
      },
    ];
    installChatUiRuntime(chatUi);
    const context = chatUi.createChatContext();
    fixture.context = context;
    const store = new AcpChatStore('startup-diagnostic', 'project-1', 'task-1');
    fixture.store = store;
    store.setDraftText('Keep this draft');
    if (populated) {
      store.chatState.transcript.history.seed([
        {
          id: 'previous-turn',
          seq: 0,
          initiator: 'user',
          items: [{ kind: 'message', id: 'previous-message', seq: 0, role: 'user', text: 'Hello' }],
        },
      ]);
      runInAction(() => {
        store.messageCount = 1;
      });
    }
    const retry = vi.spyOn(store, 'retry').mockImplementation(() => {
      runInAction(() => {
        store.loadError = null;
      });
    });
    const parent = document.createElement('div');
    parent.style.cssText = 'width:1000px;height:700px;position:relative;font-family:system-ui';
    parent.className = 'emlight';
    const css = document.createElement('style');
    css.textContent =
      '.relative {position:relative}.absolute {position:absolute}.h-full {height:100%}.overflow-hidden {overflow:hidden}.inset-0 {inset:0}.pointer-events-auto {pointer-events:auto}';
    document.head.append(css);
    document.body.append(parent);
    const root = createRoot(parent);
    try {
      await act(async () => root.render(<AcpChatPanel />));
      await vi.waitFor(() =>
        expect(parent.querySelector('[contenteditable="true"]')).not.toBeNull()
      );
      await act(async () => {
        runInAction(() => {
          store.loadError = {
            kind: 'auth_required',
            message: 'Authentication required: Click the Login button to authenticate.',
          };
        });
      });
      await expect.element(page.getByText('Droid needs you to sign in.')).toBeVisible();
      await expect
        .element(page.getByText('Open droid in a terminal and complete the provider sign-in flow.'))
        .toBeVisible();
      expect(parent.querySelector('[contenteditable="true"]')).toBeNull();
      expect(store.draftText).toBe('Keep this draft');

      vi.mocked(openModal).mockResolvedValueOnce({
        success: false,
        error: { type: 'modal_dismissed', reason: 'explicit' },
      });
      await act(async () => page.getByRole('button', { name: 'Sign in', exact: true }).click());
      expect(openModal).toHaveBeenLastCalledWith('agentSignInModal', {
        providerId: 'droid',
        methodId: 'cli-login',
        providerName: 'Droid',
        host: { type: 'local', id: 'local' },
      });
      expect(retry).not.toHaveBeenCalled();
      const authError = store.loadError;
      await act(async () => page.getByRole('button', { name: 'Retry', exact: true }).click());
      expect(retry).toHaveBeenCalledOnce();
      await act(async () =>
        runInAction(() => {
          store.loadError = authError;
        })
      );

      vi.mocked(openModal).mockResolvedValueOnce({ success: true, data: undefined });
      await act(async () => page.getByRole('button', { name: 'Sign in', exact: true }).click());
      await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(2));
      await vi.waitFor(() =>
        expect(parent.querySelector('[contenteditable="true"]')).not.toBeNull()
      );
      expect(store.draftText).toBe('Keep this draft');
      if (populated) {
        expect(store.chatState.transcript.state.displayTurns).toHaveLength(1);
        expect(parent.textContent).toContain('Hello');
      }
    } finally {
      await act(async () => root.unmount());
      store.dispose();
      context.dispose();
      parent.remove();
      css.remove();
      fixture.providerId = 'codex';
      fixture.restored = false;
      fixture.agents = [];
      vi.mocked(openModal).mockReset();
    }
  }
);

it('restores caret, viewport and undo/redo across conversation and non-chat tab switches', async () => {
  await page.viewport(1100, 800);
  fixture.restored = false;
  installChatUiRuntime(chatUi);
  const context = chatUi.createChatContext();
  fixture.context = context;
  const a = new AcpChatStore('startup-diagnostic', 'project-1', 'task-1');
  const b = new AcpChatStore('second-conversation', 'project-1', 'task-1');
  runInAction(() => {
    b.historyKnown = true;
  });
  a.setDraftText(
    Array.from({ length: 60 }, (_, i) => `Line ${i}: a long draft to preserve`).join('\n')
  );
  b.setDraftText('Independent draft B');
  const active = observable.box<AcpChatStore | null>(a, { deep: false });
  fixture.pane = {
    get resolvedTabs() {
      const store = active.get();
      return store ? [{ isActive: true, kind: 'acp-chat', resource: { store } }] : [];
    },
  };
  const parent = document.createElement('div');
  parent.style.cssText = 'width:1000px;height:700px;position:relative;font-family:system-ui';
  parent.className = 'emlight';
  const css = document.createElement('style');
  css.textContent =
    '.relative {position:relative}.absolute {position:absolute}.h-full {height:100%}.overflow-hidden {overflow:hidden}.inset-0 {inset:0}';
  document.head.append(css);
  document.body.append(parent);
  const root = createRoot(parent);
  type Editor = ReturnType<PromptEditorModel['attach']>['editor'];
  const input = () =>
    parent.querySelector<HTMLElement & { editor: Editor }>('[data-testid="prompt-editor"]')!;
  const viewport = () => {
    let element = input().parentElement!;
    while (getComputedStyle(element).overflowY !== 'auto') element = element.parentElement!;
    return element;
  };
  async function switchTo(store: AcpChatStore | null) {
    await act(async () => runInAction(() => active.set(store)));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  try {
    await act(async () => root.render(<AcpChatPanel />));
    await vi.waitFor(() => expect(input()).not.toBeNull());
    const editor = input().editor;
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.focus();
    });
    await act(async () => userEvent.keyboard(' final edit'));
    const text = a.draftText;
    const selection = editor.state.selection.toJSON();
    viewport().scrollTop = viewport().scrollHeight;
    const bottom = viewport().scrollTop;
    expect(bottom).toBeGreaterThan(500);

    await switchTo(b);
    expect(input().textContent).toBe('Independent draft B');
    expect(editor.isDestroyed).toBe(true);
    expect(editor.options.element).toBeNull();
    await act(async () => userEvent.keyboard('B edit'));
    const draftB = b.draftText;
    await switchTo(a);
    expect(input().editor === editor).toBe(true);
    expect(document.activeElement === input()).toBe(true);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(viewport().scrollTop).toBe(bottom);

    // Exercise the actual keyboard shortcut, not a history command invoked by the test.
    const modifier = /Mac/.test(navigator.platform) ? 'Meta' : 'Control';
    await act(async () => userEvent.keyboard(`{${modifier}>}z{/${modifier}}`));
    expect(a.draftText).not.toBe(text);
    expect(b.draftText).toBe(draftB);
    await switchTo(b);
    await switchTo(a);
    await act(async () => userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`));
    expect(a.draftText).toBe(text);

    // A backward range and an intentionally scrolled-away caret are both view state.
    await act(async () => editor.commands.setTextSelection({ from: 120, to: 20 }));
    const range = editor.state.selection.toJSON();
    viewport().scrollTop = 300;
    await switchTo(null);
    expect(input()).toBeNull();
    await switchTo(a);
    expect(editor.state.selection.toJSON()).toEqual(range);
    expect(viewport().scrollTop).toBe(300);
    expect(document.activeElement === input()).toBe(true);
  } finally {
    await act(async () => root.unmount());
    const releaseA = vi.spyOn(a.composerModel, 'dispose');
    const releaseB = vi.spyOn(b.composerModel, 'dispose');
    a.dispose();
    b.dispose();
    expect(releaseA).toHaveBeenCalledOnce();
    expect(releaseB).toHaveBeenCalledOnce();
    fixture.pane = undefined;
    context.dispose();
    parent.remove();
    css.remove();
  }
});

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
      startSession: conversationsContract.acp.startSession,
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
      {
        acp: {
          attach: async () => ok({ sessionId: 'session-1' }),
          startSession: async () => ok({ sessionId: 'session-1' }),
          session,
          loadHistory,
        },
      },
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

it.each([
  'history',
  'config',
  'usage',
  'plan',
  'terminals',
  'mcpServers',
  'activeTurn',
  'mcp-acquisition',
  'mcp-failure',
] as const)(
  'shows the initial live turn while %s is still loading, without requiring another chunk',
  async (delayed) => {
    fixture.restored = true;
    installChatUiRuntime(chatUi);
    const context = chatUi.createChatContext();
    fixture.context = context;
    const current: TranscriptTurn = {
      id: 'current',
      seq: 0,
      initiator: 'user',
      items: [
        { kind: 'message', id: 'current-user', seq: 0, role: 'user', text: 'My current request' },
        {
          kind: 'message',
          id: 'current-answer',
          seq: 1,
          role: 'assistant',
          text: 'Work currently in progress',
        },
      ],
    };
    const position = {
      generation: 'current-generation',
      historyRevision: 0,
      lastCommittedTurnSeq: null,
    };
    const state = cell<SessionState>({
      lifecycle: 'working',
      activeTurnId: 'control-turn',
      pendingPermissions: [],
      lastStopReason: null,
      lastTurnErrored: false,
      queuedPrompts: [],
      agentTurnActive: false,
      backgroundAgentCount: 0,
      isGenerating: true,
      canSubmit: true,
      canCancel: true,
      transcript: { ...position, activeTurn: current },
    });
    const configValue: SessionConfigState = {
      modelOptions: null,
      efforts: null,
      modeOptions: null,
      availableCommands: [],
    };
    const states = {
      config: cell<SessionConfigState | undefined>(configValue),
      usage: cell<SessionUsage | null | undefined>(null),
      plan: cell<PlanState | null | undefined>(null),
      terminals: cell<TerminalState[] | undefined>([]),
      mcpServers: cell<SessionMcpServer[] | undefined>([]),
      activeTurn: cell<TranscriptTurn | null | undefined>(current),
    };
    if (delayed !== 'history' && delayed !== 'mcp-acquisition' && delayed !== 'mcp-failure')
      states[delayed].set(undefined);
    const contract = defineContract({
      acp: defineContract({
        attach: conversationsContract.acp.attach,
        startSession: conversationsContract.acp.startSession,
        session: conversationsContract.acp.session,
        loadHistory: conversationsContract.acp.loadHistory,
      }),
    });
    const gate = deferred<void>();
    const session = expose(contract.acp.session, {
      ...states,
      state,
      agents: cell([]),
      mcpServers:
        delayed === 'mcp-acquisition' || delayed === 'mcp-failure'
          ? async () => {
              await gate.promise;
              if (delayed === 'mcp-failure') throw new Error('MCP metadata unavailable');
              return states.mcpServers;
            }
          : states.mcpServers,
    });
    const loadHistory = vi.fn(async () => {
      if (delayed === 'history') await gate.promise;
      return ok({
        turns: [],
        nextCursor: null,
        position,
        coverage: { fromSeq: null, beforeSeq: null },
      });
    });
    const hub = createWireSessionHub(
      createController(
        contract,
        {
          acp: {
            attach: async () => ok({ sessionId: 'session-1' }),
            startSession: async () => ok({ sessionId: 'session-1' }),
            session,
            loadHistory,
          },
        },
        { validate: 'full' }
      )
    );
    const pair = memoryTransportPair();
    hub.open('live-readiness', pair.right);
    const connection = connect(pair.left);
    fixture.client = client(contract, connection);
    const store = new AcpChatStore('startup-diagnostic', 'project-1', 'task-1');
    fixture.store = store;
    const parent = document.createElement('div');
    parent.style.cssText = 'width:1000px;height:700px;position:relative';
    document.body.append(parent);
    const root = createRoot(parent);
    try {
      await act(async () => root.render(<AcpChatPanel />));
      store.bootstrap();
      await vi.waitFor(() => expect(store.messageCount).toBe(2));
      await vi.waitFor(() => expect(parent.textContent).toContain('Work currently in progress'));
      await vi.waitFor(() => expect(parent.textContent).not.toContain('Loading chat...'));
      expect(store.session?.usable).toBe(true);
      expect(parent.querySelector('[contenteditable="true"]')).not.toBeNull();
      if (delayed === 'history') expect(store.historyLoading).toBe(true);

      gate.resolve();
      states.config.set(configValue);
      states.usage.set(null);
      states.plan.set(null);
      states.terminals.set([]);
      states.mcpServers.set([]);
      states.activeTurn.set(current);
      flushStateTurn();
      await vi.waitFor(() => expect(store.historyLoading).toBe(false));
      expect(store.loadError).toBeNull();
      expect(store.messageCount).toBe(2);
    } finally {
      gate.resolve();
      await act(async () => root.unmount());
      store.dispose();
      connection.dispose();
      await hub.dispose();
      await session.dispose();
      context.dispose();
      parent.remove();
    }
  }
);

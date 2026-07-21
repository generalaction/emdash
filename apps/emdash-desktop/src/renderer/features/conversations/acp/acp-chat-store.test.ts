import type { Result } from '@emdash/shared';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpLiveSession } from '@renderer/lib/acp/acp-live-session';
import { AcpChatStore } from './acp-chat-store';
import { bindSessionTerminalOutputs } from './acp-terminal-output-binding';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock('@emdash/chat-ui', () => ({
  connectSession: vi.fn(),
  createChatState: vi.fn(() => ({
    dispose: vi.fn(),
    scroll: { set: vi.fn() },
    session: {
      state: { pendingPrompt: null },
      setPendingPrompt: vi.fn(),
      setTerminalOutput: vi.fn(),
    },
    transcript: {
      history: { seed: vi.fn() },
      state: { activeTurnSnapshot: null, committedTurns: [] },
    },
  })),
  pinTopMode: vi.fn(),
}));

vi.mock('@renderer/lib/chat/advertised-command-provider', () => ({
  registerConversationCommands: vi.fn(),
  unregisterConversationCommands: vi.fn(),
}));

vi.mock('@renderer/lib/chat/shared-chat-context', () => ({
  getSharedChatContext: vi.fn(() => ({})),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: vi.fn(),
  getTaskStore: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/workspace-registry', () => ({
  workspaceRegistry: { get: vi.fn() },
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: mocks.toast,
}));

vi.mock('../stores/conversation-registry', () => ({
  conversationRegistry: { get: vi.fn() },
}));

class FakeLiveList<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  current(): T {
    return this.value;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: T): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

class FakeLog {
  private listeners = new Set<() => void>();

  constructor(private value: string) {}

  text(): string {
    return this.value;
  }

  onAppend(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: string): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function modelStore(initialModel = 'composer-2.5') {
  let selectedModel = initialModel;
  const modelChange = deferred<Result<void, unknown>>();
  const queuePrompt = vi.fn();
  const sendPrompt = vi.fn();
  const setModelOption = vi.fn(() => modelChange.promise);
  const session = {
    config: {
      current: () => ({
        modelOptions: {
          available: [],
          configId: 'model',
          selected: selectedModel,
        },
      }),
    },
    dispose: vi.fn(),
    queuePrompt,
    sendPrompt,
    sessionState: {
      current: () => ({
        canCancel: false,
        canSubmit: true,
        isGenerating: false,
        pendingPermissions: [],
        queuedPrompts: [],
      }),
    },
    setModelOption,
  } as unknown as AcpLiveSession;
  const store = new AcpChatStore('conversation-1', 'project-1', 'task-1');
  runInAction(() => {
    store.session = session;
  });

  return {
    modelChange,
    queuePrompt,
    sendPrompt,
    session,
    setConfirmedModel(model: string) {
      selectedModel = model;
    },
    setModelOption,
    store,
  };
}

describe('AcpChatStore model selection', () => {
  beforeEach(() => {
    mocks.toast.mockClear();
  });

  it('shows the requested model immediately and serializes changes while it is pending', () => {
    const { queuePrompt, sendPrompt, setModelOption, store } = modelStore();

    store.setModel('grok-4.5');

    expect(store.model).toBe('grok-4.5');
    expect(store.isModelChanging).toBe(true);
    expect(store.affordances.canSubmit).toBe(false);
    expect(setModelOption).toHaveBeenCalledWith('model', 'grok-4.5');

    expect(store.submitPrompt('Do not race the model switch')).toBe(false);
    expect(store.queuePrompt('Do not queue against the rebuilding harness')).toBe(false);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(queuePrompt).not.toHaveBeenCalled();

    store.setModel('grok-4.6');
    expect(setModelOption).toHaveBeenCalledTimes(1);
    expect(store.model).toBe('grok-4.5');
  });

  it('keeps the request pending when the matching config update arrives before the RPC result', async () => {
    const { modelChange, setConfirmedModel, store } = modelStore();
    store.setModel('grok-4.5');

    setConfirmedModel('grok-4.5');
    expect(store.isModelChanging).toBe(true);

    modelChange.resolve({ success: true, data: undefined });
    await flushPromises();

    expect(store.isModelChanging).toBe(false);
    expect(store.model).toBe('grok-4.5');
  });

  it('rolls back to session config when the RPC succeeds without a config update', async () => {
    const { modelChange, store } = modelStore();
    store.setModel('grok-4.5');

    modelChange.resolve({ success: true, data: undefined });
    await flushPromises();

    expect(store.isModelChanging).toBe(false);
    expect(store.model).toBe('composer-2.5');
  });

  it('shows a fallback model reported before the RPC succeeds', async () => {
    const { modelChange, setConfirmedModel, store } = modelStore();
    store.setModel('grok-4.5');
    setConfirmedModel('grok-4.1-fast');

    modelChange.resolve({ success: true, data: undefined });
    await flushPromises();

    expect(store.isModelChanging).toBe(false);
    expect(store.model).toBe('grok-4.1-fast');
  });

  it('rolls back to the confirmed model when the RPC returns an error', async () => {
    const { modelChange, store } = modelStore();
    store.setModel('grok-4.5');

    modelChange.resolve({ success: false, error: new Error('model unavailable') });
    await flushPromises();

    expect(store.isModelChanging).toBe(false);
    expect(store.model).toBe('composer-2.5');
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to change model', variant: 'destructive' })
    );
  });

  it('rolls back to the confirmed model when the RPC rejects', async () => {
    const { modelChange, store } = modelStore();
    store.setModel('grok-4.5');

    modelChange.reject(new Error('connection lost'));
    await flushPromises();

    expect(store.isModelChanging).toBe(false);
    expect(store.model).toBe('composer-2.5');
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to change model', variant: 'destructive' })
    );
  });

  it('ignores a late rejection after the store is disposed', async () => {
    const { modelChange, store } = modelStore();
    store.setModel('grok-4.5');

    store.dispose();
    modelChange.reject(new Error('connection closed'));
    await flushPromises();

    expect(store.isModelChanging).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe('bindSessionTerminalOutputs', () => {
  it('mirrors terminal log text and clears it on terminal removal', async () => {
    const terminals = new FakeLiveList([{ terminalId: 'term-1' }]);
    const log = new FakeLog('initial output');
    const terminalOutput = vi.fn(async () => log);
    const outputs = new Map<string, string | null>();

    const dispose = bindSessionTerminalOutputs({ terminals, terminalOutput }, (terminalId, text) =>
      outputs.set(terminalId, text)
    );
    await flushPromises();

    expect(terminalOutput).toHaveBeenCalledWith('term-1');
    expect(outputs.get('term-1')).toBe('initial output');

    log.set('live output');
    expect(outputs.get('term-1')).toBe('live output');

    terminals.set([]);
    expect(outputs.get('term-1')).toBeNull();

    log.set('late output');
    expect(outputs.get('term-1')).toBeNull();

    dispose();
  });

  it('clears mirrored outputs when disposed', async () => {
    const terminals = new FakeLiveList([{ terminalId: 'term-1' }]);
    const log = new FakeLog('initial output');
    const outputs = new Map<string, string | null>();

    const dispose = bindSessionTerminalOutputs(
      { terminals, terminalOutput: async () => log },
      (terminalId, text) => outputs.set(terminalId, text)
    );
    await flushPromises();

    dispose();
    expect(outputs.get('term-1')).toBeNull();

    log.set('late output');
    expect(outputs.get('term-1')).toBeNull();
  });
});

import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeChatProviderId } from '@shared/conversation-ui';
import type { Conversation } from '@shared/conversations';
import type { NativeChatItem } from '@shared/native-chat';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  touchConversation: vi.fn(),
  setProviderSessionId: vi.fn(),
  getProviderSettings: vi.fn(),
  getHookPort: vi.fn(),
  getHookToken: vi.fn(),
  captureTelemetry: vi.fn(),
  maybeAutoTrustLocal: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));
vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.captureTelemetry },
}));
vi.mock('@main/core/conversations/touchConversation', () => ({
  touchConversation: mocks.touchConversation,
}));
vi.mock('@main/core/conversations/set-provider-session-id', () => ({
  setProviderSessionId: mocks.setProviderSessionId,
}));
vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: { getItem: mocks.getProviderSettings },
}));
vi.mock('@main/core/agent-hooks/agent-hook-service', () => ({
  agentHookService: {
    getPort: mocks.getHookPort,
    getToken: mocks.getHookToken,
  },
}));
vi.mock('@main/core/agent-hooks/notification', () => ({ isAppFocused: () => false }));
vi.mock('@main/core/agent-hooks/workspace-trust-service', () => ({
  workspaceTrustService: { maybeAutoTrustLocal: mocks.maybeAutoTrustLocal },
}));
vi.mock('@main/core/conversations/impl/provider-env', () => ({
  resolveProviderEnv: () => ({}),
}));
vi.mock('@main/core/pty/pty-env', () => ({
  buildAgentEnv: () => ({}),
}));

import { NativeChatService } from './native-chat-service';

type TestSession = {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: NativeChatProviderId;
  items: NativeChatItem[];
  itemIndexByKey: Map<string, number>;
  turnStatus: 'idle' | 'running';
  lastError: string | null;
  turnSeq: number;
  turnDurationsMs: Record<string, number>;
  child: ChildProcess | null;
  interruptRequested: boolean;
  disposed: boolean;
};

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn();
}

function session(overrides: Partial<TestSession> = {}): TestSession {
  return {
    conversationId: 'conv-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    items: [],
    itemIndexByKey: new Map(),
    turnStatus: 'running',
    lastError: null,
    turnSeq: 0,
    turnDurationsMs: {},
    child: null,
    interruptRequested: false,
    disposed: false,
    ...overrides,
  };
}

function sessionsOf(service: NativeChatService): Map<string, TestSession> {
  return (service as unknown as { sessions: Map<string, TestSession> }).sessions;
}

describe('NativeChatService disposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.touchConversation.mockResolvedValue(undefined);
    mocks.getProviderSettings.mockResolvedValue(undefined);
    mocks.maybeAutoTrustLocal.mockResolvedValue(undefined);
    mocks.getHookPort.mockReturnValue(0);
  });

  it('prepares workspace trust before spawning a native turn', async () => {
    const service = new NativeChatService();
    const child = new FakeChild();
    mocks.spawn.mockReturnValue(child);

    await service.startTurn({
      conversation: {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'claude',
        autoApprove: true,
      } as Conversation,
      cwd: '/tmp/worktree',
      taskEnvVars: {},
      prompt: 'hello',
    });

    expect(mocks.maybeAutoTrustLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'claude',
        cwd: '/tmp/worktree',
        force: true,
      })
    );
    expect(mocks.spawn).toHaveBeenCalled();

    child.emit('close', 0);
  });

  it('reserves the conversation before async turn setup completes', async () => {
    const service = new NativeChatService();
    const child = new FakeChild();
    let releaseTrust!: () => void;
    mocks.spawn.mockReturnValue(child);
    mocks.maybeAutoTrustLocal.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseTrust = resolve;
      })
    );

    const conversation = {
      id: 'conv-1',
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'claude',
      autoApprove: false,
    } as Conversation;
    const first = service.startTurn({
      conversation,
      cwd: '/tmp/worktree',
      taskEnvVars: {},
      prompt: 'first',
    });

    await expect(
      service.startTurn({
        conversation,
        cwd: '/tmp/worktree',
        taskEnvVars: {},
        prompt: 'second',
      })
    ).rejects.toThrow('already working');

    releaseTrust();
    await first;
    child.emit('close', 0);
  });

  it('waits for a running child to close before resolving disposal', async () => {
    const service = new NativeChatService();
    const child = new FakeChild();
    sessionsOf(service).set('conv-1', session({ child: child as unknown as ChildProcess }));

    let resolved = false;
    const dispose = service.dispose('conv-1').then(() => {
      resolved = true;
    });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await Promise.resolve();
    expect(resolved).toBe(false);

    child.emit('close', null);
    await dispose;

    expect(resolved).toBe(true);
    expect(service.getState('conv-1').turnStatus).toBe('idle');
  });

  it('disposes every session for a task without touching other tasks', async () => {
    const service = new NativeChatService();
    const first = new FakeChild();
    const second = new FakeChild();
    const other = new FakeChild();
    sessionsOf(service).set('conv-1', session({ child: first as unknown as ChildProcess }));
    sessionsOf(service).set(
      'conv-2',
      session({ conversationId: 'conv-2', child: second as unknown as ChildProcess })
    );
    sessionsOf(service).set(
      'conv-3',
      session({
        conversationId: 'conv-3',
        taskId: 'task-2',
        child: other as unknown as ChildProcess,
      })
    );

    const dispose = service.disposeTask('project-1', 'task-1');
    first.emit('close', null);
    second.emit('close', null);
    await dispose;

    expect(first.kill).toHaveBeenCalledWith('SIGTERM');
    expect(second.kill).toHaveBeenCalledWith('SIGTERM');
    expect(other.kill).not.toHaveBeenCalled();
    expect(service.getState('conv-3').conversationId).toBe('conv-3');
  });
});

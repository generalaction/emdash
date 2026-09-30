import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRuntimeTarget } from '@core/features/conversations/node/conversation-runtime-target';
import {
  createStartInitialConversation,
  type StartInitialConversationDependencies,
} from './mcp-initial-conversation';

const { resolveTarget, hydrate } = vi.hoisted(() => ({
  resolveTarget: vi.fn(),
  hydrate: vi.fn(),
}));
vi.mock('@core/features/conversations/node/conversation-runtime-target', () => ({
  resolveConversationRuntimeTarget: resolveTarget,
}));
vi.mock('@core/features/conversations/node/hydrateConversation', () => ({
  hydrateConversation: hydrate,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function fixture() {
  const target: ConversationRuntimeTarget = {
    conversationId: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    conversationType: 'acp',
    providerId: 'claude',
    sessionId: null,
    workspacePath: '/worktrees/task-1',
    host: LOCAL_HOST_REF,
    acpInput: {
      conversationId: 'conversation-1',
      providerId: 'claude',
      cwd: '/worktrees/task-1',
      sessionId: null,
      options: { model: 'sonnet' },
      initialQueue: [{ text: 'Fix the bug' }],
      env: { EMDASH_TASK_ID: 'task-1' },
    },
  };
  resolveTarget.mockResolvedValue(target);
  const startSession = vi.fn(async () => ok({ sessionId: 'session-1' }));
  const attach = vi.fn();
  const dependencies = {
    db: {},
    logger: { warn: vi.fn() },
    runtimes: { client: vi.fn(async () => ok({ acp: { startSession, attach } })) },
    taskSessions: {},
    sessionLaunchContexts: {},
    telemetry: {},
    workspaceIdentity: {},
    getProviderEnv: vi.fn(),
  } as unknown as StartInitialConversationDependencies;
  const input = { projectId: 'project-1', taskId: 'task-1', conversationId: 'conversation-1' };
  return { target, dependencies, startSession, attach, input };
}

describe('createStartInitialConversation', () => {
  it('starts ACP rather than only attaching a suspended handle', async () => {
    const { target, dependencies, startSession, attach, input } = fixture();
    const result = await createStartInitialConversation(dependencies)({ ...input, type: 'acp' });
    expect(result).toEqual({ started: true });
    expect(startSession).toHaveBeenCalledWith(
      { ...target.acpInput, mode: 'resume' },
      { timeoutMs: 0 }
    );
    expect(attach).not.toHaveBeenCalled();
    expect(resolveTarget).toHaveBeenCalledWith(
      input.conversationId,
      dependencies.workspaceIdentity,
      dependencies.db,
      dependencies.getProviderEnv,
      dependencies.sessionLaunchContexts
    );
  });

  it('reports an unavailable host without trying to start a session', async () => {
    const { dependencies, startSession, input } = fixture();
    vi.mocked(dependencies.runtimes.client).mockResolvedValue(
      err({ type: 'host-unavailable', message: 'offline' }) as never
    );
    const result = await createStartInitialConversation(dependencies)({ ...input, type: 'acp' });
    expect(result).toMatchObject({
      started: false,
      message: expect.stringContaining('unavailable'),
    });
    expect(startSession).not.toHaveBeenCalled();
  });

  it('keeps terminal startup on the task hydration path', async () => {
    const { dependencies, startSession, input } = fixture();
    hydrate.mockResolvedValue(undefined);
    const result = await createStartInitialConversation(dependencies)({ ...input, type: 'pty' });
    expect(result).toEqual({ started: true });
    expect(hydrate).toHaveBeenCalledWith(
      dependencies.db,
      dependencies.taskSessions,
      input.projectId,
      input.taskId,
      input.conversationId,
      dependencies.telemetry
    );
    expect(startSession).not.toHaveBeenCalled();
  });
});

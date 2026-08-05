import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '@main/core/conversations/createConversation';
import { getConversationsForTask } from '@main/core/conversations/getConversationsForTask';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import { acpLoopSessionDriver } from './acp-driver';

const acpSessionManagerMock = vi.hoisted(() => ({
  registerPermissionAutoApproval: vi.fn(),
  start: vi.fn(),
  prompt: vi.fn(),
  cancel: vi.fn(),
  stop: vi.fn(),
  getChatHistory: vi.fn(),
}));
vi.mock('@main/core/acp/production-acp-session-manager', () => ({
  acpSessionManager: acpSessionManagerMock,
}));

vi.mock('@main/core/conversations/createConversation', () => ({
  createConversation: vi.fn(),
}));

vi.mock('@main/core/conversations/getConversationsForTask', () => ({
  getConversationsForTask: vi.fn(),
}));

describe('acpLoopSessionDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acpSessionManagerMock.getChatHistory.mockReturnValue({ turns: [], complete: true });
    acpSessionManagerMock.start.mockResolvedValue({ success: true, data: undefined });
    acpSessionManagerMock.stop.mockReturnValue({ success: true, data: undefined });
    vi.mocked(getConversationsForTask).mockResolvedValue([]);
  });

  function makeLoopContext(patch: Partial<Loop> = {}): {
    loop: Loop;
    phase: LoopPhase;
    purpose: 'work';
    target: {
      workspaceId: string;
      path: string;
      machine: { kind: 'local' };
    };
    taskEnvironment: Readonly<Record<string, string>>;
  } {
    const loop: Loop = {
      id: 'loop-1',
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Loop',
      slug: 'loop',
      status: 'running',
      currentPhaseIndex: 0,
      config: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...patch,
    };
    const phase: LoopPhase = {
      id: 'phase-1',
      loopId: loop.id,
      idx: 0,
      name: 'Phase',
      goal: 'Do the work',
      status: 'pending',
      attempts: 0,
      conversationId: null,
      criteria: null,
      lastError: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    return {
      loop,
      phase,
      purpose: 'work',
      target: { workspaceId: 'workspace-1', path: '/worktree', machine: { kind: 'local' } },
      taskEnvironment: { EMDASH_TASK_ID: 'task-1', EMDASH_TASK_PATH: '/worktree' },
    };
  }

  it('registers newly created loop ACP conversations for permission auto-approval', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce({
      id: 'conv-loop',
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'claude',
      title: 'loop-1',
      type: 'acp',
      isInitialConversation: false,
      lastInteractedAt: null,
    });
    const context = makeLoopContext();
    const result = await acpLoopSessionDriver.startPhaseSession(context);

    expect(result.success).toBe(true);
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude',
        type: 'acp',
      })
    );
    expect(acpSessionManagerMock.registerPermissionAutoApproval).toHaveBeenCalledWith('conv-loop');
    expect(acpSessionManagerMock.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-loop' }),
      context.target.workspaceId,
      context.target.path,
      context.target.machine,
      undefined,
      context.taskEnvironment
    );
  });

  it('uses the loop config provider when creating ACP conversations', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce({
      id: 'conv-codex',
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'codex' as const,
      title: 'loop-1',
      type: 'acp',
      isInitialConversation: false,
      lastInteractedAt: null,
    });
    const result = await acpLoopSessionDriver.startPhaseSession(
      makeLoopContext({
        config: {
          version: '1',
          provider: 'codex',
          verifiers: ['gh'],
          reviewEnabled: false,
          validationCommands: ['pnpm run test'],
          planSource: 'manual',
        },
      })
    );

    expect(result.success).toBe(true);
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        type: 'acp',
      })
    );
    expect(acpSessionManagerMock.registerPermissionAutoApproval).toHaveBeenCalledWith('conv-codex');
  });

  it('starts verification conversations with auto-approval and a verify title', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce({
      id: 'conv-verify',
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'claude',
      title: 'loop-1-verify',
      type: 'acp',
      isInitialConversation: false,
      lastInteractedAt: null,
    });
    const context = makeLoopContext();
    const result = await acpLoopSessionDriver.startVerificationSession({
      loop: context.loop,
      phase: context.phase,
      purpose: 'browser-verification',
      target: context.target,
      taskEnvironment: context.taskEnvironment,
    });

    expect(result.success).toBe(true);
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'loop-1-verify',
        type: 'acp',
        isInitialConversation: false,
      })
    );
    expect(acpSessionManagerMock.registerPermissionAutoApproval).toHaveBeenCalledWith(
      'conv-verify'
    );
    expect(acpSessionManagerMock.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-verify' }),
      context.target.workspaceId,
      context.target.path,
      context.target.machine,
      undefined,
      context.taskEnvironment
    );
  });

  it('uses strict ACP prompt routing and never returns literal undefined as the error message', async () => {
    acpSessionManagerMock.prompt.mockResolvedValueOnce({
      success: false,
      error: undefined,
    });

    const result = await acpLoopSessionDriver.sendPrompt('conv-1', 'hello');

    expect(acpSessionManagerMock.registerPermissionAutoApproval).toHaveBeenCalledWith('conv-1');
    expect(acpSessionManagerMock.prompt).toHaveBeenCalledWith('conv-1', 'hello', undefined, {
      requireRuntime: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('ACP prompt failed');
      expect(result.error.message).not.toBe('undefined');
    }
  });

  it('restarts the same persisted verification conversation with exact target authority', async () => {
    const context = makeLoopContext();
    const conversation = {
      id: 'conv-verify',
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'codex' as const,
      title: 'loop-1-verify',
      type: 'acp' as const,
      isInitialConversation: false,
      lastInteractedAt: null,
    };
    vi.mocked(getConversationsForTask).mockResolvedValueOnce([conversation]);

    const result = await acpLoopSessionDriver.restartVerificationSession!({
      loop: context.loop,
      phase: context.phase,
      purpose: 'browser-verification',
      conversationId: conversation.id,
      target: context.target,
      taskEnvironment: context.taskEnvironment,
    });

    expect(result).toEqual({
      success: true,
      data: { conversationId: conversation.id, title: 'loop-1-verify' },
    });
    expect(acpSessionManagerMock.stop).toHaveBeenCalledWith(conversation.id);
    expect(acpSessionManagerMock.start).toHaveBeenCalledWith(
      conversation,
      context.target.workspaceId,
      context.target.path,
      context.target.machine,
      undefined,
      context.taskEnvironment
    );
  });

  it('ignores literal undefined ACP error messages', async () => {
    acpSessionManagerMock.prompt.mockResolvedValueOnce({
      success: false,
      error: { type: 'prompt_failed', message: 'undefined' },
    });

    const result = await acpLoopSessionDriver.sendPrompt('conv-1', 'hello');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('ACP error: prompt_failed');
      expect(result.error.message).not.toBe('undefined');
    }
  });

  it('prefers structured ACP cause messages for prompt failures', async () => {
    acpSessionManagerMock.prompt.mockResolvedValueOnce({
      success: false,
      error: {
        type: 'prompt_failed',
        cause: { name: 'AcpProcessClosed', message: 'ACP agent process exited with code 1' },
      },
    });

    const result = await acpLoopSessionDriver.sendPrompt('conv-1', 'hello');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('ACP agent process exited with code 1');
    }
  });

  it('does not fall back to normal task hydration when the explicit runtime is missing', async () => {
    acpSessionManagerMock.prompt.mockResolvedValueOnce({
      success: false,
      error: { type: 'conversation_not_found', message: 'ACP conversation is not running' },
    });

    const result = await acpLoopSessionDriver.sendPrompt('conv-1', 'hello');

    expect(result.success).toBe(false);
    expect(acpSessionManagerMock.registerPermissionAutoApproval).toHaveBeenCalledWith('conv-1');
    expect(acpSessionManagerMock.prompt).toHaveBeenCalledOnce();
  });

  it('uses strict ACP cancel routing', async () => {
    acpSessionManagerMock.cancel.mockResolvedValueOnce({ success: true, data: undefined });

    const result = await acpLoopSessionDriver.cancelPrompt('conv-1');

    expect(result.success).toBe(true);
    expect(acpSessionManagerMock.cancel).toHaveBeenCalledWith('conv-1', {
      requireRuntime: true,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '@main/core/conversations/createConversation';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import { acpLoopSessionDriver } from './acp-driver';

const acpSessionManagerMock = vi.hoisted(() => ({
  registerPermissionAutoApproval: vi.fn(),
  prompt: vi.fn(),
  cancel: vi.fn(),
  getChatHistory: vi.fn(),
}));
const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
}));
const hydrateConversationMock = vi.hoisted(() => vi.fn());

function mockConversationLookup(row: { projectId: string; taskId: string } | null): void {
  dbMock.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => (row ? [row] : []),
      }),
    }),
  });
}

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}));

vi.mock('@main/db/client', () => ({
  db: dbMock,
}));

vi.mock('@main/db/schema', () => ({
  conversations: {
    id: {},
    projectId: {},
    taskId: {},
  },
}));

vi.mock('@main/core/acp/production-acp-session-manager', () => ({
  acpSessionManager: acpSessionManagerMock,
}));

vi.mock('@main/core/conversations/createConversation', () => ({
  createConversation: vi.fn(),
}));

vi.mock('@main/core/conversations/hydrateConversation', () => ({
  hydrateConversation: hydrateConversationMock,
}));

describe('acpLoopSessionDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acpSessionManagerMock.getChatHistory.mockReturnValue({ turns: [], complete: true });
    mockConversationLookup({ projectId: 'project-1', taskId: 'task-1' });
  });

  function makeLoopContext(): { loop: Loop; phase: LoopPhase; review: boolean } {
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
    return { loop, phase, review: false };
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
    hydrateConversationMock.mockResolvedValueOnce(undefined);

    const result = await acpLoopSessionDriver.startPhaseSession(makeLoopContext());

    expect(result.success).toBe(true);
    expect(acpSessionManagerMock.registerPermissionAutoApproval).toHaveBeenCalledWith('conv-loop');
    expect(hydrateConversationMock).toHaveBeenCalledWith('project-1', 'task-1', 'conv-loop');
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
    hydrateConversationMock.mockResolvedValueOnce(undefined);

    const context = makeLoopContext();
    const result = await acpLoopSessionDriver.startVerificationSession({
      loop: context.loop,
      phase: context.phase,
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
    expect(hydrateConversationMock).toHaveBeenCalledWith('project-1', 'task-1', 'conv-verify');
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

  it('hydrates an existing conversation and retries when no ACP runtime is registered', async () => {
    acpSessionManagerMock.prompt
      .mockResolvedValueOnce({
        success: false,
        error: { type: 'conversation_not_found', message: 'ACP conversation is not running' },
      })
      .mockResolvedValueOnce({ success: true, data: undefined });

    const result = await acpLoopSessionDriver.sendPrompt('conv-1', 'hello');

    expect(result.success).toBe(true);
    expect(acpSessionManagerMock.registerPermissionAutoApproval).toHaveBeenCalledWith('conv-1');
    expect(hydrateConversationMock).toHaveBeenCalledWith('project-1', 'task-1', 'conv-1');
    expect(acpSessionManagerMock.prompt).toHaveBeenCalledTimes(2);
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

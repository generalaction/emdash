import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '@main/core/conversations/createConversation';
import { getConversationsForTask } from '@main/core/conversations/getConversationsForTask';
import { setSessionId } from '@main/core/conversations/set-session-id';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import { acpLoopSessionDriver } from './acp-driver';
import { getLoopAcpRuntime } from './acp-loop-runtime';

const runtimeMock = vi.hoisted(() => ({
  startSession: vi.fn(),
  stopSession: vi.fn(),
  sendPrompt: vi.fn(),
  cancelTurn: vi.fn(),
  resolvePermission: vi.fn(),
  getSessionState: vi.fn(),
  getChatHistory: vi.fn(),
}));

vi.mock('./acp-loop-runtime', () => ({ getLoopAcpRuntime: vi.fn() }));
vi.mock('@main/core/conversations/createConversation', () => ({ createConversation: vi.fn() }));
vi.mock('@main/core/conversations/getConversationsForTask', () => ({
  getConversationsForTask: vi.fn(),
}));
vi.mock('@main/core/conversations/set-session-id', () => ({ setSessionId: vi.fn() }));

describe('acpLoopSessionDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLoopAcpRuntime).mockResolvedValue(runtimeMock as never);
    vi.mocked(setSessionId).mockResolvedValue({ success: true, data: undefined });
    vi.mocked(getConversationsForTask).mockResolvedValue([]);
    runtimeMock.startSession.mockResolvedValue({ success: true, data: { sessionId: 'agent-1' } });
    runtimeMock.stopSession.mockReturnValue({ success: true, data: undefined });
    runtimeMock.cancelTurn.mockResolvedValue({ success: true, data: undefined });
    runtimeMock.getSessionState.mockReturnValue({ pendingPermissions: [] });
    runtimeMock.getChatHistory.mockReturnValue({ committed: [], active: null });
  });

  function makeLoopContext(patch: Partial<Loop> = {}) {
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
      purpose: 'work' as const,
      target: {
        workspaceId: 'workspace-1',
        path: '/worktree',
        machine: { kind: 'local' as const },
      },
      taskEnvironment: { EMDASH_TASK_ID: 'task-1', EMDASH_TASK_PATH: '/worktree' },
    };
  }

  function conversation(id = 'conv-loop') {
    return {
      id,
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'claude' as const,
      title: 'loop-1',
      type: 'acp' as const,
      isInitialConversation: false,
      lastInteractedAt: null,
    };
  }

  it('starts a targeted ACP session and preserves the trusted task environment', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(conversation());
    const context = makeLoopContext();

    const result = await acpLoopSessionDriver.startPhaseSession(context);

    expect(result.success).toBe(true);
    expect(getLoopAcpRuntime).toHaveBeenCalledWith(context.target.machine);
    expect(runtimeMock.startSession).toHaveBeenCalledWith({
      conversationId: 'conv-loop',
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'claude',
      workspaceId: 'workspace-1',
      cwd: '/worktree',
      sessionId: null,
      model: null,
      env: context.taskEnvironment,
    });
    expect(setSessionId).toHaveBeenCalledWith('conv-loop', 'agent-1');
  });

  it('uses the configured provider and model', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce({
      ...conversation('conv-codex'),
      providerId: 'codex',
      model: 'gpt-5.6-sol',
    });
    const context = makeLoopContext({
      config: {
        version: '2',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        verifiers: ['gh'],
        reviewEnabled: false,
        validationCommands: ['pnpm run test'],
        planSource: 'manual',
        terminalGates: { review: false, e2e: false },
        browserPreview: { enabled: false },
      },
    });

    await acpLoopSessionDriver.startPhaseSession(context);

    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'codex', model: 'gpt-5.6-sol', type: 'acp' })
    );
    expect(runtimeMock.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'codex', model: 'gpt-5.6-sol' })
    );
  });

  it('auto-approves Loop permissions and returns the final assistant text', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(conversation('conv-prompt'));
    await acpLoopSessionDriver.startPhaseSession(makeLoopContext());
    runtimeMock.getSessionState.mockReturnValue({
      pendingPermissions: [
        {
          requestId: 'permission-1',
          options: [
            { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
          ],
        },
      ],
    });
    runtimeMock.sendPrompt.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, data: {} }), 5))
    );
    runtimeMock.getChatHistory.mockReturnValue({
      committed: [
        {
          id: 'turn-1',
          seq: 1,
          initiator: 'user',
          items: [
            { kind: 'message', id: 'm1', seq: 1, role: 'assistant', text: 'Finished safely.' },
          ],
        },
      ],
      active: null,
    });

    const result = await acpLoopSessionDriver.sendPrompt('conv-prompt', 'Build it');

    expect(result).toEqual({ success: true, data: { finalText: 'Finished safely.' } });
    expect(runtimeMock.resolvePermission).toHaveBeenCalledWith(
      'conv-prompt',
      'permission-1',
      'always'
    );
  });

  it('restarts the same persisted verification conversation on its exact target', async () => {
    const context = makeLoopContext();
    const saved = { ...conversation('conv-verify'), sessionId: 'agent-existing' };
    vi.mocked(getConversationsForTask).mockResolvedValueOnce([saved]);

    const result = await acpLoopSessionDriver.restartVerificationSession!({
      loop: context.loop,
      phase: context.phase,
      purpose: 'browser-verification',
      conversationId: saved.id,
      target: context.target,
      taskEnvironment: context.taskEnvironment,
    });

    expect(result.success).toBe(true);
    expect(runtimeMock.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: saved.id, sessionId: 'agent-existing' })
    );
  });

  it('fails closed when prompt routing has no targeted runtime', async () => {
    const result = await acpLoopSessionDriver.sendPrompt('missing-conversation', 'hello');

    expect(result).toEqual({
      success: false,
      error: {
        kind: 'prompt-failed',
        message: 'ACP conversation is not running in its targeted Loop runtime',
      },
    });
    expect(runtimeMock.sendPrompt).not.toHaveBeenCalled();
  });

  it('stops a new runtime if its ACP session id cannot be persisted', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(conversation('conv-unpersisted'));
    vi.mocked(setSessionId).mockResolvedValueOnce({
      success: false,
      error: { type: 'conversation-not-found', message: 'conv-unpersisted' },
    });

    const result = await acpLoopSessionDriver.startPhaseSession(makeLoopContext());

    expect(result.success).toBe(false);
    expect(runtimeMock.stopSession).toHaveBeenCalledWith('conv-unpersisted');
  });
});

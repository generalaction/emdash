import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acpLoopSessionDriver } from './acp-driver';

const acpSessionManagerMock = vi.hoisted(() => ({
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

  it('uses strict ACP prompt routing and never returns literal undefined as the error message', async () => {
    acpSessionManagerMock.prompt.mockResolvedValueOnce({
      success: false,
      error: undefined,
    });

    const result = await acpLoopSessionDriver.sendPrompt('conv-1', 'hello');

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

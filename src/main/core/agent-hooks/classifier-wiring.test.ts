import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wireAgentClassifier } from './classifier-wiring';

const mocks = vi.hoisted(() => ({
  classify: vi.fn(),
  emit: vi.fn(),
  maybeShowNotification: vi.fn(),
  recordAgentEvent: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('@main/core/conversations/chat/chat-conversation-runtime', () => ({
  chatConversationRuntime: {
    recordAgentEvent: mocks.recordAgentEvent,
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
  },
}));

vi.mock('./classifiers', () => ({
  createClassifier: () => ({
    classify: mocks.classify,
  }),
}));

vi.mock('./notification', () => ({
  maybeShowNotification: mocks.maybeShowNotification,
}));

describe('wireAgentClassifier', () => {
  let onData: ((chunk: string) => void) | undefined;
  let onExit: ((info: { exitCode?: number; signal?: number | string }) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    onData = undefined;
    onExit = undefined;
    mocks.classify.mockImplementation((chunk: string) =>
      chunk === ''
        ? {
            type: 'error',
            message: 'failed',
          }
        : undefined
    );
    mocks.recordAgentEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records classifier events into the chat timeline before emitting agent events', async () => {
    wireAgentClassifier({
      pty: {
        onData: (callback: (chunk: string) => void) => {
          onData = callback;
        },
        onExit: (callback: (info: { exitCode?: number; signal?: number | string }) => void) => {
          onExit = callback;
        },
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      },
      providerId: 'codex',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
    });

    onData?.('failed');
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.recordAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        conversationId: 'conversation-1',
        payload: expect.objectContaining({ message: 'failed' }),
      })
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agent:event' }),
      expect.objectContaining({
        event: expect.objectContaining({ type: 'error' }),
      })
    );
    onExit?.({});
  });
});

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

  function wireClassifier(): void {
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
  }

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
    mocks.maybeShowNotification.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records classifier events into the chat timeline before emitting agent events', async () => {
    wireClassifier();

    onData?.('failed');
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.recordAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        conversationId: 'conversation-1',
        payload: expect.objectContaining({
          message: 'failed',
        }),
      })
    );
    expect(mocks.recordAgentEvent.mock.calls[0]?.[0].payload).not.toHaveProperty(
      'lastAssistantMessage'
    );
    expect(mocks.recordAgentEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.emit.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agent:event' }),
      expect.objectContaining({
        event: expect.objectContaining({ type: 'error' }),
      })
    );
    onExit?.({});
  });

  it('still emits agent events when chat timeline recording fails', async () => {
    mocks.recordAgentEvent.mockRejectedValue(new Error('timeline failed'));
    wireClassifier();

    onData?.('failed');
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agent:event' }),
      expect.objectContaining({
        event: expect.objectContaining({ type: 'error' }),
      })
    );
  });

  it('still emits agent events when notification display fails', async () => {
    mocks.maybeShowNotification.mockRejectedValue(new Error('notification failed'));
    wireClassifier();

    onData?.('failed');
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agent:event' }),
      expect.objectContaining({
        event: expect.objectContaining({ type: 'error' }),
      })
    );
  });

  it('does not arm idle emission when classifier input handling throws', async () => {
    mocks.classify.mockImplementationOnce(() => {
      throw new Error('classify failed');
    });
    wireClassifier();

    onData?.('failed');
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.recordAgentEvent).not.toHaveBeenCalled();
  });

  it('clears an existing idle timer when later classifier input handling throws', async () => {
    wireClassifier();

    onData?.('first');
    await vi.advanceTimersByTimeAsync(1000);
    mocks.classify.mockImplementationOnce(() => {
      throw new Error('classify failed');
    });
    onData?.('second');
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.recordAgentEvent).not.toHaveBeenCalled();
  });

  it('does not emit agent events when idle classification throws', async () => {
    mocks.classify.mockImplementation((chunk: string) => {
      if (chunk === '') throw new Error('idle classify failed');
      return undefined;
    });
    wireClassifier();

    onData?.('failed');
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.recordAgentEvent).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { makePtySessionId } from '@shared/ptySessionId';
import { resolveTask } from '../projects/utils';
import type { Pty, PtyExitInfo } from '../pty/pty';
import { ConversationSessionVisibilityService } from './conversation-session-visibility';

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
  },
}));

const stopSession = vi.fn();
const resolveTaskMock = vi.mocked(resolveTask);

vi.mock('../projects/utils', () => ({
  resolveTask: vi.fn(() => ({
    conversations: {
      stopSession,
    },
  })),
}));

class FakePty implements Pty {
  write(): void {}
  resize(): void {}
  kill(): void {}
  onData(): void {}
  onExit(_handler: (info: PtyExitInfo) => void): void {}
}

describe('ConversationSessionVisibilityService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopSession.mockReset();
    stopSession.mockResolvedValue(undefined);
    resolveTaskMock.mockReturnValue({
      conversations: {
        stopSession,
      },
    } as unknown as ReturnType<typeof resolveTask>);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    ptySessionRegistry.unregister(makePtySessionId('project-1', 'task-1', 'conv-1'));
    ptySessionRegistry.unregister(makePtySessionId('project-1', 'task-1', 'conv-2'));
  });

  it('stops an active conversation PTY after it leaves the visible pane set', () => {
    const service = new ConversationSessionVisibilityService();
    const sessionId = makePtySessionId('project-1', 'task-1', 'conv-1');
    ptySessionRegistry.register(sessionId, new FakePty(), {
      metadata: { providerId: 'codex', title: 'Agent' },
    });

    service.updateVisibleConversations('project-1', 'task-1', []);
    vi.advanceTimersByTime(29_999);
    expect(stopSession).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(stopSession).toHaveBeenCalledWith('conv-1');
  });

  it('cancels the pending stop when the conversation becomes visible again', () => {
    const service = new ConversationSessionVisibilityService();
    const sessionId = makePtySessionId('project-1', 'task-1', 'conv-1');
    ptySessionRegistry.register(sessionId, new FakePty(), {
      metadata: { providerId: 'codex', title: 'Agent' },
    });

    service.updateVisibleConversations('project-1', 'task-1', []);
    service.updateVisibleConversations('project-1', 'task-1', ['conv-1']);
    vi.advanceTimersByTime(30_000);

    expect(stopSession).not.toHaveBeenCalled();
  });

  it('stops a hidden conversation PTY that starts after a non-empty visibility update', () => {
    const service = new ConversationSessionVisibilityService();
    const sessionId = makePtySessionId('project-1', 'task-1', 'conv-1');

    service.updateVisibleConversations('project-1', 'task-1', ['conv-2']);
    ptySessionRegistry.register(sessionId, new FakePty(), {
      metadata: { providerId: 'codex', title: 'Agent' },
    });
    service.onConversationSessionStarted('project-1', 'task-1', 'conv-1');

    vi.advanceTimersByTime(30_000);

    expect(stopSession).toHaveBeenCalledWith('conv-1');
  });

  it('uses the scheduled task stop handler if the task is removed before the timer fires', () => {
    const service = new ConversationSessionVisibilityService();
    const sessionId = makePtySessionId('project-1', 'task-1', 'conv-1');
    ptySessionRegistry.register(sessionId, new FakePty(), {
      metadata: { providerId: 'codex', title: 'Agent' },
    });

    service.updateVisibleConversations('project-1', 'task-1', []);
    resolveTaskMock.mockReturnValue(null);
    vi.advanceTimersByTime(30_000);

    expect(stopSession).toHaveBeenCalledWith('conv-1');
  });
});

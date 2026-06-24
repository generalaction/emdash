import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { ptySessionRegistry } from './pty-session-registry';

vi.mock('./persist-dropped-blob', () => ({
  cleanupExpiredDroppedBlobs: vi.fn().mockResolvedValue(undefined),
  persistClipboardImagePath: vi.fn(),
  persistDroppedBlobBytes: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../tasks/task-session-manager', () => ({
  taskSessionManager: {},
}));

vi.mock('../workspaces/workspace-registry', () => ({
  workspaceRegistry: {},
}));

const emitSpy = vi.spyOn(conversationEvents, '_emit');

const { ptyController } = await import('./controller');

function makePty(write = vi.fn()) {
  return {
    write,
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

describe('ptyController', () => {
  beforeEach(() => {
    emitSpy.mockClear();
  });

  it('emits input-submitted for remote agent PTYs on enter', () => {
    const write = vi.fn();
    const sessionId = 'proj-1:task-1:conv-1';
    ptySessionRegistry.register(sessionId, makePty(write), {
      metadata: { providerId: 'amp', isRemote: true },
    });

    const result = ptyController.sendInput(sessionId, 'hello\r');

    expect(result.success).toBe(true);
    expect(write).toHaveBeenCalledWith('hello\r');
    expect(emitSpy).toHaveBeenCalledWith('conversation:input-submitted', {
      projectId: 'proj-1',
      taskId: 'task-1',
      conversationId: 'conv-1',
      providerId: 'amp',
    });

    ptySessionRegistry.unregister(sessionId);
  });
});

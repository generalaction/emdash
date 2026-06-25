import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { taskSessionManager } from '../tasks/task-session-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
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

  it('uploads remote attachments into the git-ignored .emdash dir, not the worktree root (#2680)', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const copyLocalFile = vi.fn().mockResolvedValue(undefined);
    const workspace = { path: '/remote/worktree', fs: { mkdir, copyLocalFile } };

    const taskMgr = taskSessionManager as unknown as {
      getTask: (id: string) => unknown;
      getWorkspaceId: (id: string) => string;
    };
    taskMgr.getTask = vi.fn(() => ({}));
    taskMgr.getWorkspaceId = vi.fn(() => 'ws-1');
    const wsReg = workspaceRegistry as unknown as { get: (id: string) => unknown };
    wsReg.get = vi.fn(() => workspace);

    const result = await ptyController.uploadFiles({
      sessionId: 'proj-1:task-1:conv-1',
      localPaths: ['/local/tmp/emdash-drop-abc-image.png'],
    });

    expect(result.success).toBe(true);
    expect(mkdir).toHaveBeenCalledWith('.emdash/uploads', { recursive: true });
    expect(copyLocalFile).toHaveBeenCalledTimes(1);

    const [src, destRel] = copyLocalFile.mock.calls[0]!;
    expect(src).toBe('/local/tmp/emdash-drop-abc-image.png');
    expect(destRel).toMatch(/^\.emdash\/uploads\/[0-9a-f-]+-emdash-drop-abc-image\.png$/);

    if (result.success) {
      // Lands under the git-ignored .emdash dir, never directly in the worktree root.
      expect(result.data.remotePaths[0]).toMatch(
        /^\/remote\/worktree\/\.emdash\/uploads\/[0-9a-f-]+-emdash-drop-abc-image\.png$/
      );
    }
  });
});

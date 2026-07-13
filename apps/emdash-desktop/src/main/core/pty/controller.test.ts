import type * as nodeCrypto from 'node:crypto';
import type * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { filesClientScope } from '@main/core/files/runtime-client';
import { nativePathFromHost, resolveRelativePath } from '@shared/core/runtime/paths';
import { ptySessionRegistry } from './pty-session-registry';

const mocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceId: vi.fn(),
  randomUUID: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof nodeCrypto>();
  return { ...actual, randomUUID: mocks.randomUUID };
});

vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof fsPromises>();
  return { ...actual, readFile: mocks.readFile };
});

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
  taskSessionManager: {
    getTask: mocks.getTask,
    getWorkspaceId: mocks.getWorkspaceId,
  },
}));

vi.mock('../workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    get: mocks.getWorkspace,
  },
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
    vi.clearAllMocks();
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
    const bytes = Buffer.from('content');
    const mkdir = vi.fn().mockResolvedValue({ success: true });
    const writeBytes = vi.fn().mockResolvedValue({ success: true });
    mocks.randomUUID.mockReturnValue('upload-id');
    mocks.readFile.mockResolvedValue(bytes);
    mocks.getTask.mockReturnValue({});
    mocks.getWorkspaceId.mockReturnValue('workspace-1');
    const files = filesClientScope(
      {
        fs: {
          exists: vi.fn(async ({ relative }) => ({ success: true, data: relative === '.emdash' })),
          upload: vi.fn(async ({ root, path }, file) => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of file.source) chunks.push(chunk);
            await writeBytes(
              nativePathFromHost(resolveRelativePath(root, path)),
              Buffer.concat(chunks)
            );
            return { success: true, data: { bytesWritten: bytes.byteLength } };
          }),
        },
        mutations: {
          createDirectory: vi.fn(async ({ root, path }) => {
            await mkdir(nativePathFromHost(resolveRelativePath(root, path)), { recursive: true });
            return { success: true, data: undefined };
          }),
        },
      } as never,
      '/remote/worktree'
    );
    mocks.getWorkspace.mockReturnValue({
      path: '/remote/worktree',
      files,
    });

    const result = await ptyController.uploadFiles({
      sessionId: 'proj-1:task-1:conv-1',
      localPaths: ['/local/tmp/emdash-drop-abc-image.png'],
    });

    expect(result).toEqual({
      success: true,
      data: {
        remotePaths: ['/remote/worktree/.emdash/uploads/upload-id-emdash-drop-abc-image.png'],
      },
    });
    expect(mkdir).toHaveBeenCalledWith('/remote/worktree/.emdash/uploads', { recursive: true });
    expect(writeBytes).toHaveBeenCalledWith(
      '/remote/worktree/.emdash/uploads/upload-id-emdash-drop-abc-image.png',
      bytes
    );
  });
});

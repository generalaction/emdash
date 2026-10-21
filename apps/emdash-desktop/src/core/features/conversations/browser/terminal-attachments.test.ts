import { MAX_ATTACHMENT_FILES } from '@emdash/core/services/attachments/api';
import { deferred } from '@emdash/shared/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceTerminalAttachments } from '@core/features/terminals/api/browser/terminal-attachments';
import { createConversationTerminalAttachments } from './terminal-attachments';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  workspaceUpload: vi.fn(),
  workspaceRemove: vi.fn(),
  prepareLocalFiles: vi.fn(),
  workspacePrepare: vi.fn(),
  persistDroppedBlob: vi.fn(),
}));
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => ({
    attachments: {
      upload: mocks.upload,
      delete: mocks.remove,
      prepareLocalFiles: mocks.prepareLocalFiles,
    },
  }),
}));
vi.mock('@core/features/terminals/api/browser/client', () => ({
  getTerminalsClient: async () => ({
    attachments: {
      upload: mocks.workspaceUpload,
      delete: mocks.workspaceRemove,
      prepareLocalFiles: mocks.workspacePrepare,
    },
  }),
}));
vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  getHostClient: async () => mocks,
}));
const ref = {
  id: 'image-1',
  name: 'image.png',
  mimeType: 'image/png',
  targetPath: '/host/attachments/image 1.png',
  pathStyle: 'posix' as const,
};
const file = () => new File(['text'], 'notes.txt');
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue({ success: true, data: ref });
  mocks.workspaceUpload.mockResolvedValue({ success: true, data: ref });
  mocks.remove.mockResolvedValue({ success: true });
  mocks.workspaceRemove.mockResolvedValue({ success: true });
  mocks.prepareLocalFiles.mockResolvedValue({
    success: true,
    data: [{ kind: 'attachment', ...ref }],
  });
  mocks.workspacePrepare.mockResolvedValue({
    success: true,
    data: [{ kind: 'attachment', ...ref }],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('terminal attachment owners and batches', () => {
  it('captures the conversation and streams dropped bytes', async () => {
    const target = createConversationTerminalAttachments('original');
    createConversationTerminalAttachments('other');
    const callSignal = signal();
    const result = await target.prepareFiles([file()], callSignal);
    expect(mocks.upload).toHaveBeenCalledWith(
      { conversationId: 'original' },
      expect.objectContaining({ name: 'notes.txt' }),
      { signal: callSignal }
    );
    const received = [];
    for await (const chunk of mocks.upload.mock.calls[0][1].source) received.push(...chunk);
    expect(new TextDecoder().decode(new Uint8Array(received))).toBe('text');
    expect(result.paths).toEqual([ref.targetPath]);
  });

  it('routes shell uploads and rollback to the workspace owner', async () => {
    const target = createWorkspaceTerminalAttachments('workspace-1');
    const result = await target.prepareFiles([file()], signal());
    expect(mocks.workspaceUpload.mock.calls[0][0]).toEqual({ workspaceId: 'workspace-1' });
    expect(mocks.upload).not.toHaveBeenCalled();
    await result.discard();
    expect(mocks.workspaceRemove).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      attachmentId: ref.id,
    });
  });

  it('sends clipboard paths to main without reading bytes in the renderer', async () => {
    const callSignal = signal();
    await createConversationTerminalAttachments('conv').prepareLocalSnapshots(
      ['/local/clipboard.png'],
      callSignal
    );
    expect(mocks.prepareLocalFiles).toHaveBeenCalledWith(
      { conversationId: 'conv', sources: [{ path: '/local/clipboard.png', snapshot: true }] },
      { signal: callSignal }
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('passes stable native files to main before applying any upload size cap', async () => {
    vi.stubGlobal('window', { electronAPI: { getPathForFile: () => '/local/original.txt' } });
    const original = file();
    Object.defineProperty(original, 'size', { value: 100 * 1024 * 1024 });
    mocks.prepareLocalFiles.mockResolvedValue({
      success: true,
      data: [{ kind: 'reference', targetPath: '/local/original.txt', pathStyle: 'posix' }],
    });
    const result = await createConversationTerminalAttachments('conv').prepareFiles(
      [original],
      signal()
    );
    expect(result.paths).toEqual(['/local/original.txt']);
    await result.discard();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('snapshots clipboard files even when Electron exposes a stable native path', async () => {
    vi.stubGlobal('window', { electronAPI: { getPathForFile: () => '/local/clipboard.png' } });
    await createConversationTerminalAttachments('conv').prepareFiles([file()], signal(), true);
    expect(mocks.prepareLocalFiles.mock.calls[0][0].sources[0].snapshot).toBe(true);
  });

  it('uses path style returned by the owning host', async () => {
    mocks.upload.mockResolvedValue({
      success: true,
      data: { ...ref, pathStyle: 'win32', targetPath: 'C:\\attachments\\image.png' },
    });
    const result = await createConversationTerminalAttachments('conv').prepareFiles(
      [file()],
      signal()
    );
    expect(result.platform).toBe('win32');
  });

  it('sends native HEIC to main for conversion without a renderer byte round trip', async () => {
    vi.stubGlobal('window', { electronAPI: { getPathForFile: () => '/local/photo.heic' } });
    await createConversationTerminalAttachments('conv').prepareFiles(
      [new File(['image'], 'photo.heic', { type: 'image/heic' })],
      signal()
    );
    expect(mocks.prepareLocalFiles.mock.calls[0][0].sources).toEqual([
      { path: '/local/photo.heic', name: 'photo.heic', mimeType: 'image/heic', snapshot: false },
    ]);
    expect(mocks.persistDroppedBlob).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('transfers sequentially and rolls back earlier files when a later file fails', async () => {
    const first = deferred<{ success: true; data: typeof ref }>();
    mocks.upload.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      success: false,
      error: { type: 'storage-failed', message: 'disk full' },
    });
    const pending = createConversationTerminalAttachments('conv').prepareFiles(
      [file(), file()],
      signal()
    );
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    first.resolve({ success: true, data: ref });
    await expect(pending).rejects.toThrow('disk full');
    expect(mocks.remove).toHaveBeenCalledWith({ conversationId: 'conv', attachmentId: ref.id });
  });

  it('rolls back successful responses received after cancellation', async () => {
    const controller = new AbortController();
    mocks.upload.mockImplementation(async () => {
      controller.abort();
      return { success: true, data: ref };
    });
    await expect(
      createConversationTerminalAttachments('conv').prepareFiles(
        [file(), file()],
        controller.signal
      )
    ).rejects.toThrow();
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('rejects oversized batches before opening uploads', async () => {
    await expect(
      createConversationTerminalAttachments('conv').prepareFiles(
        Array.from({ length: MAX_ATTACHMENT_FILES + 1 }, file),
        signal()
      )
    ).rejects.toThrow('20 files');
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});

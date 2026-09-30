import { deferred } from '@emdash/shared/testing';
import type * as uiPrimitivesModule from '@emdash/ui/react/primitives';
import { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationTerminalAttachments } from '@core/features/conversations/browser/terminal-attachments';
import { FrontendPty } from '@core/features/terminals/api/browser/pty/pty';
import type { PtyPane as PtyPaneType } from '@core/features/terminals/contributions/browser/pty/pty-pane';
import type * as hostClientModule from '@core/primitives/desktop-host/browser/host-client';
import {
  clearDraggedWorkspaceFile,
  setDraggedWorkspaceFile,
} from '@core/primitives/drag-files/browser/drag-files';

const upload = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const persistClipboardImage = vi.hoisted(() =>
  vi.fn(async () => ({ success: true as const, path: '/laptop/tmp/paste.png' }))
);

vi.mock('@core/services/settings/api/client', () => ({
  getAppSettingsClient: async () => ({ get: async () => ({}) }),
}));
vi.mock('@core/primitives/desktop-host/browser/host-client', async (importOriginal) => ({
  ...(await importOriginal<typeof hostClientModule>()),
  getHostClient: async () => ({
    events: { subscribe: async () => () => {} },
    getPlatform: async () => 'darwin',
    persistClipboardImage,
    persistDroppedBlob: vi.fn(),
  }),
}));
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => ({
    attachments: {
      upload,
      prepareLocalFiles: async (input: unknown, options: unknown) => {
        const result = await upload(input, { name: 'paste.png' }, options);
        return result.success
          ? { success: true, data: [{ kind: 'attachment', ...result.data }] }
          : result;
      },
      delete: vi.fn(async () => ({ success: true })),
    },
  }),
}));
vi.mock('@emdash/ui/react/primitives', async (importOriginal) => {
  const original = await importOriginal<typeof uiPrimitivesModule>();
  const toast = Object.assign(vi.fn(), { error: toastError, dismiss: vi.fn() });
  return {
    ...original,
    toast,
  };
});

let PtyPane: typeof PtyPaneType;

const uploaded = {
  success: true as const,
  data: {
    id: 'attachment-1',
    name: 'image.png',
    mimeType: 'image/png',
    targetPath: '/remote/attachments/image.png',
    pathStyle: 'posix' as const,
  },
};

function Harness({
  pty,
  workspaceId = 'remote-workspace',
  conversationId = 'conversation-1',
  readOnly = false,
}: {
  pty: FrontendPty;
  workspaceId?: string;
  conversationId?: string;
  readOnly?: boolean;
}) {
  const attachments = useMemo(
    () => createConversationTerminalAttachments(conversationId),
    [conversationId]
  );
  return (
    <div style={{ width: 800, height: 400 }}>
      <PtyPane
        pty={pty}
        sessionId={pty.sessionId}
        workspaceId={workspaceId}
        attachments={attachments}
        readOnly={readOnly}
      />
    </div>
  );
}

function fileTransfer(name: string, type: string): DataTransfer {
  const transfer = new DataTransfer();
  transfer.items.add(new File(['contents'], name, { type, lastModified: 1 }));
  return transfer;
}

function dispatchImagePaste(container: HTMLElement, name = 'paste.png'): void {
  container.dispatchEvent(
    new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: fileTransfer(name, 'image/png'),
    })
  );
}

function dispatchFileDrop(container: HTMLElement, name = 'document.pdf'): void {
  container.dispatchEvent(
    new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: fileTransfer(name, 'application/pdf'),
    })
  );
}

function dispatchNativePasteShortcut(pty: FrontendPty): void {
  pty.terminal.textarea?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('terminal attachments through PtyPane and real xterm', () => {
  let root: Root;
  let rootMounted: boolean;
  let host: HTMLDivElement;
  let pty: FrontendPty;
  let ptys: FrontendPty[];
  let input: string[];

  beforeAll(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('');
    ({ PtyPane } = await import('@core/features/terminals/contributions/browser/pty/pty-pane'));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    for (const [name, value] of Object.entries({
      '--xterm-bg': '#101010',
      '--xterm-fg': '#f0f0f0',
      '--xterm-cursor': '#f0f0f0',
      '--xterm-cursor-accent': '#101010',
      '--xterm-selection-bg': '#335577',
      '--xterm-selection-fg': '#ffffff',
    })) {
      document.documentElement.style.setProperty(name, value);
    }

    upload.mockReset();
    toastError.mockReset();
    persistClipboardImage.mockReset();
    persistClipboardImage.mockResolvedValue({
      success: true,
      path: '/laptop/tmp/paste.png',
    });
    vi.stubGlobal('electronAPI', {
      getPathForFile: (file: File) => `/laptop/files/${file.name}`,
    });

    input = [];
    pty = new FrontendPty('terminal-attachments', undefined, undefined, undefined, {
      connect: () => () => {},
      sendInput: (data) => input.push(data),
    });
    ptys = [pty];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    rootMounted = true;
    await act(async () => root.render(<Harness pty={pty} />));
    pty.terminal.focus();
  });

  afterEach(async () => {
    vi.useRealTimers();
    clearDraggedWorkspaceFile();
    if (rootMounted) await act(async () => root.unmount());
    // Let xterm finish layout queued by reparenting before disposing its renderer.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    for (const terminalPty of ptys) terminalPty.dispose();
    host.remove();
    document.querySelector('[data-terminal-host="true"]')?.remove();
  });

  function terminalContainer(): HTMLElement {
    const container = host.querySelector<HTMLElement>('[data-terminal-container]');
    if (!container) throw new Error('Expected the terminal container to be mounted');
    return container;
  }

  it.each([
    ['image paste', dispatchImagePaste],
    ['file drop', dispatchFileDrop],
  ] as const)('sends %s in one bracketed paste after upload', async (_name, dispatch) => {
    const pending = deferred<typeof uploaded>();
    upload.mockReturnValue(pending.promise);
    dispatch(terminalContainer());
    await flushAsyncWork();
    expect(upload).toHaveBeenCalledOnce();
    expect(input).toEqual([]);
    pending.resolve(uploaded);
    await flushAsyncWork();
    // Assert the actual PTY writes: no extra byte may follow the paste-end marker,
    // even if the pane changes how it sends the correctly formatted payload.
    expect(input).toEqual(['\x1b[200~/remote/attachments/image.png \x1b[201~']);
  });

  it.each(['unmount', 'replace', 'read-only'] as const)(
    'cancels a pending upload on %s',
    async (change) => {
      const pending = deferred<typeof uploaded>();
      upload.mockReturnValue(pending.promise);
      dispatchImagePaste(terminalContainer());
      await flushAsyncWork();
      expect(upload).toHaveBeenCalledOnce();
      const signal = upload.mock.calls[0][2]?.signal;
      if (change === 'unmount') {
        await act(async () => root.unmount());
        rootMounted = false;
      } else if (change === 'replace') {
        const replacement = new FrontendPty('replacement', undefined, undefined, undefined, {
          connect: () => () => {},
          sendInput: (data) => input.push(data),
        });
        ptys.push(replacement);
        await act(async () => root.render(<Harness pty={replacement} conversationId="other" />));
      } else {
        await act(async () => root.render(<Harness pty={pty} readOnly />));
      }
      pending.resolve(uploaded);
      await flushAsyncWork();
      expect(input).toEqual([]);
      expect(signal?.aborted).toBe(true);
    }
  );

  it('deduplicates DOM and native paste beyond the timestamp window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const pending = deferred<typeof uploaded>();
    upload.mockReturnValue(pending.promise);
    dispatchNativePasteShortcut(pty);
    await flushAsyncWork();
    expect(upload).toHaveBeenCalledOnce();
    vi.setSystemTime(2000);
    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();
    vi.setSystemTime(3000);
    pending.resolve(uploaded);
    await flushAsyncWork();
    expect(upload).toHaveBeenCalledOnce();
    expect(input).toHaveLength(1);
  });

  it('does not insert a local path or fallback text on upload failure', async () => {
    upload.mockResolvedValue({
      success: false,
      error: { type: 'storage-failed', message: 'Disk full' },
    });
    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();
    expect(input).toEqual([]);
    expect(toastError).toHaveBeenCalled();
  });
  it('does not start an upload when clipboard persistence finishes after a pane change', async () => {
    const captured = deferred<{ success: true; path: string }>();
    persistClipboardImage.mockReturnValue(captured.promise);
    dispatchNativePasteShortcut(pty);
    await flushAsyncWork();
    await act(async () => root.render(<Harness pty={pty} conversationId="other" />));
    captured.resolve({ success: true, path: '/local/image.png' });
    await flushAsyncWork();
    expect(upload).not.toHaveBeenCalled();
    expect(input).toEqual([]);
  });

  it('ignores a late native clipboard result after a DOM paste already completed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const captured = deferred<{ success: true; path: string }>();
    persistClipboardImage.mockReturnValue(captured.promise);
    upload.mockResolvedValue(uploaded);
    dispatchNativePasteShortcut(pty);
    await flushAsyncWork();
    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();
    vi.setSystemTime(3000);
    captured.resolve({ success: true, path: '/local/image.png' });
    await flushAsyncWork();
    expect(upload).toHaveBeenCalledOnce();
    expect(input).toHaveLength(1);
  });

  it('uses a file-tree path directly without uploading it again', async () => {
    const transfer = new DataTransfer();
    setDraggedWorkspaceFile(transfer, {
      workspaceId: 'remote-workspace',
      targetPaths: ['/remote/repo/notes.txt'],
      targetPlatform: 'linux',
    });
    terminalContainer().dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    );
    await flushAsyncWork();
    expect(upload).not.toHaveBeenCalled();
    expect(input).toEqual(['/remote/repo/notes.txt ']);
  });
});

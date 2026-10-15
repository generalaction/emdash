import { deferred } from '@emdash/shared/testing';
import type * as uiPrimitivesModule from '@emdash/ui/react/primitives';
import { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationTerminalAttachments } from '@core/features/conversations/browser/terminal-attachments';
import { FrontendPty } from '@core/features/terminals/api/browser/pty/pty';
import type { PtyPane as PtyPaneType } from '@core/features/terminals/contributions/browser/pty/pty-pane';
import {
  clearDraggedWorkspaceFile,
  setDraggedWorkspaceFile,
} from '@core/primitives/drag-files/browser/drag-files';

const upload = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@core/services/settings/api/client', () => ({
  getAppSettingsClient: async () => ({ get: async () => ({}) }),
}));
type ClipboardSnapshot = {
  success: true;
  content: { kind: 'text'; text: string } | { kind: 'image'; path: string };
};
const clipboardImage: ClipboardSnapshot = {
  success: true,
  content: { kind: 'image', path: '/laptop/tmp/paste.png' },
};
const clipboardReadPaste = vi.hoisted(() => vi.fn());
const clipboardWriteText = vi.hoisted(() => vi.fn());

vi.mock('@core/primitives/wire/browser/connection', () => ({
  domainClient: async () => ({
    events: { subscribe: async () => () => {} },
    getPlatform: async () => 'darwin',
    clipboardReadPaste,
    clipboardWriteText,
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
    clipboardReadPaste.mockReset();
    clipboardReadPaste.mockResolvedValue(clipboardImage);
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue({ success: true });
    vi.stubGlobal('electronAPI', {
      getPathForFile: (file: File) => `/laptop/files/${file.name}`,
    });

    input = [];
    pty = new FrontendPty('terminal-attachments', undefined, undefined, undefined, {
      connect: () => () => {},
      sendInput: async (data) => {
        input.push(data);
        return true;
      },
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
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
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
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
      const signal = upload.mock.calls[0][2]?.signal;
      if (change === 'unmount') {
        await act(async () => root.unmount());
        rootMounted = false;
      } else if (change === 'replace') {
        const replacement = new FrontendPty('replacement', undefined, undefined, undefined, {
          connect: () => () => {},
          sendInput: async (data) => {
            input.push(data);
            return true;
          },
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

  it('commits a Ctrl+Shift+V image and a later DOM image paste once each, in order', async () => {
    const pending = deferred<typeof uploaded>();
    upload.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      ...uploaded,
      data: { ...uploaded.data, id: 'attachment-2', targetPath: '/remote/attachments/second.png' },
    });
    dispatchNativePasteShortcut(pty);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();
    // The keydown default was prevented, so the DOM paste is a separate deliberate paste.
    expect(upload).toHaveBeenCalledOnce();
    pending.resolve(uploaded);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(input).toEqual([
      '\x1b[200~/remote/attachments/image.png \x1b[201~',
      '\x1b[200~/remote/attachments/second.png \x1b[201~',
    ]);
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
  it('does not start an upload when the clipboard snapshot finishes after a pane change', async () => {
    const captured = deferred<ClipboardSnapshot>();
    clipboardReadPaste.mockReturnValue(captured.promise);
    dispatchNativePasteShortcut(pty);
    await flushAsyncWork();
    await act(async () => root.render(<Harness pty={pty} conversationId="other" />));
    captured.resolve({ success: true, content: { kind: 'image', path: '/local/image.png' } });
    await flushAsyncWork();
    expect(upload).not.toHaveBeenCalled();
    expect(input).toEqual([]);
  });

  it('keeps a slow native clipboard image ahead of a later DOM paste', async () => {
    const captured = deferred<ClipboardSnapshot>();
    clipboardReadPaste.mockReturnValue(captured.promise);
    upload.mockImplementation(async (input: { sources: { path: string }[] }) => ({
      ...uploaded,
      data: {
        ...uploaded.data,
        targetPath: `/remote/attachments/${input.sources[0].path.split('/').at(-1)}`,
      },
    }));
    dispatchNativePasteShortcut(pty);
    await flushAsyncWork();
    dispatchImagePaste(terminalContainer(), 'dom.png');
    await flushAsyncWork();
    expect(input).toEqual([]);
    captured.resolve({ success: true, content: { kind: 'image', path: '/local/image.png' } });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(input).toEqual([
      '\x1b[200~/remote/attachments/image.png \x1b[201~',
      '\x1b[200~/remote/attachments/dom.png \x1b[201~',
    ]);
  });

  it('keeps Ctrl+V as a terminal key on Linux', async () => {
    pty.terminal.textarea?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        keyCode: 86,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await flushAsyncWork();
    expect(clipboardReadPaste).not.toHaveBeenCalled();
    expect(input).toEqual(['\x16']);
  });

  function middleClick(init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 1,
      ...init,
    });
    pty.terminal.textarea?.dispatchEvent(event);
    return event;
  }

  it('pastes the primary selection on a middle click, never the clipboard', async () => {
    await new Promise<void>((resolve) => pty.terminal.write('\x1b[?2004h', resolve));
    clipboardReadPaste.mockImplementation(async ({ source }: { source: string }) => ({
      success: true,
      content: {
        kind: 'text',
        text: source === 'selection' ? 'primary\nselection' : 'system clipboard',
      },
    }));
    // Prevented so Chromium does not paste the selection a second time itself.
    expect(middleClick().defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(input).toEqual(['\x1b[200~primary\rselection\x1b[201~']));
    expect(clipboardReadPaste).toHaveBeenCalledExactlyOnceWith({ source: 'selection' });
  });

  it('leaves a middle click to a program that tracks the mouse', async () => {
    await new Promise<void>((resolve) => pty.terminal.write('\x1b[?1000h', resolve));
    expect(middleClick().defaultPrevented).toBe(false);
    await flushAsyncWork();
    expect(clipboardReadPaste).not.toHaveBeenCalled();
  });

  function readsBySource() {
    clipboardReadPaste.mockImplementation(async ({ source }: { source: string }) => ({
      success: true,
      content: { kind: 'text', text: source === 'selection' ? 'primary' : 'system clipboard' },
    }));
  }

  it('pastes the primary selection with a forced Shift+middle click under mouse tracking', async () => {
    await new Promise<void>((resolve) => pty.terminal.write('\x1b[?2004h\x1b[?1000h', resolve));
    readsBySource();
    expect(middleClick({ shiftKey: true }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(input).toEqual(['\x1b[200~primary\x1b[201~']));
    await flushAsyncWork();
    expect(input).toEqual(['\x1b[200~primary\x1b[201~']);
    expect(clipboardReadPaste).toHaveBeenCalledExactlyOnceWith({ source: 'selection' });
  });

  it('still pastes the primary selection when a pending clipboard copy fails', async () => {
    await new Promise<void>((resolve) => pty.terminal.write('\x1b[?2004hcopied', resolve));
    readsBySource();
    const written = deferred<void>();
    clipboardWriteText.mockImplementationOnce(async () => {
      await written.promise;
      return { success: false, error: 'Clipboard busy' };
    });
    pty.terminal.select(0, 0, 'copied'.length);
    pty.terminal.textarea?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'C',
        code: 'KeyC',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    middleClick();
    written.resolve();
    await vi.waitFor(() => expect(input).toEqual(['\x1b[200~primary\x1b[201~']));
    expect(clipboardReadPaste).toHaveBeenCalledExactlyOnceWith({ source: 'selection' });
  });

  it('uses a DOM paste event’s own payload when no copy is pending', async () => {
    await new Promise<void>((resolve) => pty.terminal.write('\x1b[?2004h', resolve));
    const payload = new DataTransfer();
    payload.setData('text/plain', 'event\npayload');
    pty.terminal.textarea?.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: payload })
    );
    await vi.waitFor(() => expect(input).toEqual(['\x1b[200~event\rpayload\x1b[201~']));
    expect(clipboardReadPaste).not.toHaveBeenCalled();
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

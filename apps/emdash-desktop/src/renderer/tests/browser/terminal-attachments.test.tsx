import { deferred } from '@emdash/shared/testing';
import type * as uiPrimitivesModule from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalsClient } from '@core/features/terminals/api/browser/client';
import { FrontendPty } from '@core/features/terminals/api/browser/pty/pty';
import type { PtyPane as PtyPaneType } from '@core/features/terminals/contributions/browser/pty/pty-pane';
import type * as hostClientModule from '@core/primitives/desktop-host/browser/host-client';
import {
  clearDraggedWorkspaceFile,
  setDraggedWorkspaceFile,
} from '@core/primitives/drag-files/browser/drag-files';

const prepareAttachments = vi.hoisted(() => vi.fn<TerminalsClient['prepareAttachments']>());
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
vi.mock('@core/features/terminals/api/browser/client', () => ({
  getTerminalsClient: async () => ({ prepareAttachments }),
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

type AttachmentResult = Awaited<ReturnType<TerminalsClient['prepareAttachments']>>;

function Harness({
  pty,
  workspaceId = 'remote-workspace',
  remoteConnectionId = 'remote-connection',
  remote = true,
  readOnly = false,
}: {
  pty: FrontendPty;
  workspaceId?: string;
  remoteConnectionId?: string;
  remote?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div style={{ width: 800, height: 400 }}>
      <PtyPane
        pty={pty}
        sessionId={pty.sessionId}
        workspaceId={workspaceId}
        remoteConnectionId={remote ? remoteConnectionId : undefined}
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

    prepareAttachments.mockReset();
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
    ['clipboard image', dispatchImagePaste, '/laptop/files/paste.png'],
    ['dropped file', dispatchFileDrop, '/laptop/files/document.pdf'],
  ] as const)(
    'uploads a remote %s before injecting only its remote path',
    async (_source, dispatch, localPath) => {
      const upload = deferred<AttachmentResult>();
      prepareAttachments.mockReturnValue(upload.promise);

      dispatch(terminalContainer());
      await flushAsyncWork();

      expect(prepareAttachments).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'remote-workspace',
          expectedHost: { type: 'remote', id: 'remote-connection' },
          localPaths: [localPath],
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(input).toEqual([]);

      upload.resolve({
        success: true,
        data: { paths: [`/remote/tmp/${localPath.split('/').at(-1)}`], pathStyle: 'posix' },
      });
      await flushAsyncWork();

      expect(input).toEqual([`\x1b[200~/remote/tmp/${localPath.split('/').at(-1)}\x1b[201~ `]);
    }
  );

  it('does not inject a path when a remote upload fails', async () => {
    prepareAttachments.mockResolvedValue({
      success: false,
      error: { type: 'terminal-wire-error', message: 'upload failed' },
    });

    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();

    expect(prepareAttachments).toHaveBeenCalledOnce();
    expect(input).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(
      'Failed to attach files',
      expect.objectContaining({ description: 'upload failed' })
    );
  });

  it('does not inject a completed remote upload after the pane unmounts', async () => {
    const upload = deferred<AttachmentResult>();
    prepareAttachments.mockReturnValue(upload.promise);

    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();
    expect(prepareAttachments).toHaveBeenCalledOnce();
    const requestOptions = prepareAttachments.mock.calls[0]?.[1];
    expect(requestOptions?.signal?.aborted).toBe(false);

    await act(async () => root.unmount());
    rootMounted = false;
    expect(requestOptions?.signal?.aborted).toBe(true);
    upload.resolve({
      success: true,
      data: { paths: ['/remote/tmp/paste.png'], pathStyle: 'posix' },
    });
    await flushAsyncWork();

    expect(input).toEqual([]);
  });

  it('does not inject a completed remote upload into a replacement pane', async () => {
    const upload = deferred<AttachmentResult>();
    prepareAttachments.mockReturnValue(upload.promise);

    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();
    expect(prepareAttachments).toHaveBeenCalledOnce();

    const replacementInput: string[] = [];
    const replacementPty = new FrontendPty(
      'replacement-terminal',
      undefined,
      undefined,
      undefined,
      {
        connect: () => () => {},
        sendInput: (data) => replacementInput.push(data),
      }
    );
    ptys.push(replacementPty);
    await act(async () =>
      root.render(
        <Harness
          pty={replacementPty}
          workspaceId="replacement-workspace"
          remoteConnectionId="replacement-connection"
        />
      )
    );

    upload.resolve({
      success: true,
      data: { paths: ['/remote/tmp/paste.png'], pathStyle: 'posix' },
    });
    await flushAsyncWork();

    expect(input).toEqual([]);
    expect(replacementInput).toEqual([]);
  });

  it('deduplicates native and DOM image paste while the remote upload is pending', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000);
    const upload = deferred<AttachmentResult>();
    prepareAttachments.mockReturnValue(upload.promise);
    dispatchNativePasteShortcut(pty);
    await flushAsyncWork();
    expect(persistClipboardImage).toHaveBeenCalledOnce();
    expect(prepareAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'remote-workspace',
        expectedHost: { type: 'remote', id: 'remote-connection' },
        localPaths: ['/laptop/tmp/paste.png'],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(input).toEqual([]);
    expect(prepareAttachments).toHaveBeenCalledOnce();

    vi.setSystemTime(2_000);
    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();

    expect(prepareAttachments).toHaveBeenCalledOnce();
    upload.resolve({
      success: true,
      data: { paths: ['/remote/tmp/paste.png'], pathStyle: 'posix' },
    });
    await flushAsyncWork();

    expect(input).toEqual(['\x1b[200~/remote/tmp/paste.png\x1b[201~ ']);
  });

  it('ignores clipboard persistence that completes after the pane changes', async () => {
    const persistence = deferred<{
      success: true;
      path: '/laptop/tmp/paste.png';
    }>();
    persistClipboardImage.mockReturnValue(persistence.promise);
    dispatchNativePasteShortcut(pty);
    await flushAsyncWork();
    expect(persistClipboardImage).toHaveBeenCalledOnce();

    const replacementInput: string[] = [];
    const replacementPty = new FrontendPty(
      'clipboard-replacement-terminal',
      undefined,
      undefined,
      undefined,
      {
        connect: () => () => {},
        sendInput: (data) => replacementInput.push(data),
      }
    );
    ptys.push(replacementPty);
    await act(async () =>
      root.render(
        <Harness
          pty={replacementPty}
          workspaceId="replacement-workspace"
          remoteConnectionId="replacement-connection"
        />
      )
    );

    persistence.resolve({ success: true, path: '/laptop/tmp/paste.png' });
    await flushAsyncWork();

    expect(prepareAttachments).not.toHaveBeenCalled();
    expect(input).toEqual([]);
    expect(replacementInput).toEqual([]);
  });

  it('aborts a pending remote upload when its pane becomes read only', async () => {
    const upload = deferred<AttachmentResult>();
    prepareAttachments.mockReturnValue(upload.promise);

    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();
    const requestOptions = prepareAttachments.mock.calls[0]?.[1];
    expect(requestOptions?.signal?.aborted).toBe(false);

    await act(async () => root.render(<Harness pty={pty} readOnly />));
    expect(requestOptions?.signal?.aborted).toBe(true);
    upload.resolve({
      success: true,
      data: { paths: ['/remote/tmp/paste.png'], pathStyle: 'posix' },
    });
    await flushAsyncWork();

    expect(input).toEqual([]);
  });

  it('keeps local image paste on the existing local path', async () => {
    await act(async () =>
      root.render(<Harness pty={pty} workspaceId="local-workspace" remote={false} />)
    );

    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();

    expect(prepareAttachments).not.toHaveBeenCalled();
    expect(input).toEqual(['\x1b[200~/laptop/files/paste.png\x1b[201~ ']);
  });

  it('uses an in-app workspace path directly without re-uploading it', async () => {
    const transfer = new DataTransfer();
    setDraggedWorkspaceFile(transfer, {
      workspaceId: 'remote-workspace',
      targetPaths: ['/remote/workspace/image.png'],
      targetPlatform: 'linux',
    });

    terminalContainer().dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      })
    );
    await flushAsyncWork();

    expect(prepareAttachments).not.toHaveBeenCalled();
    expect(input).toEqual(['/remote/workspace/image.png ']);
  });

  it('leaves plain-text paste on xterm while the pane is remote', async () => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'plain text');

    pty.terminal.textarea?.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      })
    );
    await flushAsyncWork();

    expect(prepareAttachments).not.toHaveBeenCalled();
    expect(input.join('')).toContain('plain text');
  });

  it('does not repeat a DOM paste when native clipboard reading finishes after its upload', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000);
    const clipboard = deferred<{ success: true; path: string }>();
    const upload = deferred<AttachmentResult>();
    persistClipboardImage.mockReturnValueOnce(clipboard.promise);
    prepareAttachments.mockReturnValueOnce(upload.promise);

    dispatchNativePasteShortcut(pty);
    await flushAsyncWork();
    expect(persistClipboardImage).toHaveBeenCalledOnce();
    dispatchImagePaste(terminalContainer());
    await flushAsyncWork();
    expect(prepareAttachments).toHaveBeenCalledOnce();

    vi.setSystemTime(2_000);
    upload.resolve({
      success: true,
      data: { paths: ['/remote/tmp/paste.png'], pathStyle: 'posix' },
    });
    await flushAsyncWork();
    vi.setSystemTime(3_000);
    clipboard.resolve({ success: true, path: '/laptop/tmp/paste.png' });
    await flushAsyncWork();

    expect(prepareAttachments).toHaveBeenCalledOnce();
    expect(input).toEqual(['\x1b[200~/remote/tmp/paste.png\x1b[201~ ']);
    expect(toastError).not.toHaveBeenCalled();
  });
});

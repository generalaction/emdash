import { deferred } from '@emdash/shared/testing';
import type * as uiPrimitivesModule from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrontendPty } from '@core/features/terminals/api/browser/pty/pty';
import { createWorkspaceTerminalAttachments } from '@core/features/terminals/api/browser/terminal-attachments';
import type { PtyPane as PtyPaneType } from '@core/features/terminals/contributions/browser/pty/pty-pane';

// macOS Cmd+V and Edit > Paste are browser-owned: the DOM paste event carries the clipboard.
const host = vi.hoisted(() => {
  const state = { clipboard: '' };
  return {
    state,
    client: {
      events: { subscribe: async () => () => {} },
      clipboardReadPaste: vi.fn(async ({ source }: { source: string }) => ({
        success: true as const,
        content:
          source === 'clipboard' && state.clipboard
            ? { kind: 'text' as const, text: state.clipboard }
            : { kind: 'empty' as const },
      })),
      clipboardWriteText: vi.fn(),
      persistClipboardImage: vi.fn(),
    },
  };
});
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }));

vi.mock('@core/services/settings/api/client', () => ({
  getAppSettingsClient: async () => ({ get: async () => ({}) }),
}));
vi.mock('@core/primitives/wire/browser/connection', () => ({
  domainClient: async () => host.client,
}));
vi.mock('@emdash/ui/react/primitives', async (importOriginal) => ({
  ...(await importOriginal<typeof uiPrimitivesModule>()),
  toast,
}));

let PtyPane: typeof PtyPaneType;

const framed = (text: string) => `\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`;

function textTransfer(text: string): DataTransfer {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  return data;
}

function dispatchPaste(pty: FrontendPty, data: DataTransfer): void {
  pty.terminal.textarea!.dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
  );
}

function press(pty: FrontendPty, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  pty.terminal.textarea!.dispatchEvent(event);
  return event;
}

describe('macOS terminal clipboard through PtyPane and real xterm', () => {
  let root: Root;
  let container: HTMLDivElement;
  let ptys: FrontendPty[];
  let inputs: Map<FrontendPty, string[]>;
  const releases: (() => void)[] = [];

  function createPty(sessionId: string): FrontendPty {
    const input: string[] = [];
    const pty = new FrontendPty(sessionId, undefined, undefined, undefined, {
      connect: () => () => {},
      sendInput: async (data) => {
        input.push(data);
        return true;
      },
    });
    ptys.push(pty);
    inputs.set(pty, input);
    return pty;
  }

  const inputOf = (pty: FrontendPty) => inputs.get(pty) ?? [];

  async function show(pty: FrontendPty): Promise<void> {
    await act(async () =>
      root.render(
        <div style={{ width: 800, height: 400 }}>
          <PtyPane
            attachments={createWorkspaceTerminalAttachments(pty.sessionId)}
            pty={pty}
            sessionId={pty.sessionId}
            workspaceId={pty.sessionId}
          />
        </div>
      )
    );
    await new Promise<void>((resolve) => pty.terminal.write('\x1b[?2004h', resolve));
    pty.terminal.focus();
  }

  // An app copy that has not reached the system clipboard yet.
  function holdNextCopy(succeeds = true): () => void {
    const written = deferred<void>();
    releases.push(() => written.resolve());
    host.client.clipboardWriteText.mockImplementationOnce(async ({ text }: { text: string }) => {
      await written.promise;
      if (!succeeds) return { success: false, error: 'Clipboard busy' };
      host.state.clipboard = text;
      return { success: true };
    });
    return () => written.resolve();
  }

  async function selectAndCopy(pty: FrontendPty, text: string): Promise<void> {
    await new Promise<void>((resolve) => pty.terminal.write(text, resolve));
    pty.terminal.select(0, 0, text.length);
    expect(press(pty, 'c').defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(host.client.clipboardWriteText).toHaveBeenCalled());
  }

  beforeAll(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    ({ PtyPane } = await import('@core/features/terminals/contributions/browser/pty/pty-pane'));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    host.state.clipboard = 'OLD';
    host.client.clipboardReadPaste.mockClear();
    host.client.clipboardWriteText.mockReset();
    host.client.clipboardWriteText.mockImplementation(async ({ text }: { text: string }) => {
      host.state.clipboard = text;
      return { success: true };
    });
    host.client.persistClipboardImage.mockReset();
    host.client.persistClipboardImage.mockResolvedValue({ success: true, path: null });
    toast.mockReset();
    toast.error.mockReset();
    vi.stubGlobal('electronAPI', { getPathForFile: () => '' });
    ptys = [];
    inputs = new Map();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    for (const release of releases.splice(0)) release();
    await act(async () => root.unmount());
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    for (const pty of ptys) pty.dispose();
    container.remove();
    document.querySelector('[data-terminal-host="true"]')?.remove();
  });

  it('leaves Cmd+V to the browser and converts the paste event it delivers', async () => {
    const pty = createPty('macos-paste');
    await show(pty);
    expect(press(pty, 'v').defaultPrevented).toBe(false);
    dispatchPaste(pty, textTransfer('first\nsecond\x1b[201~'));
    await vi.waitFor(() => expect(inputOf(pty)).toEqual(['\x1b[200~first\rsecond␛[201~\x1b[201~']));
    // With no app copy pending, the event's own payload is used.
    expect(host.client.clipboardReadPaste).not.toHaveBeenCalled();
  });

  it('copies the selection with Cmd+C through the desktop clipboard', async () => {
    const pty = createPty('macos-copy');
    await show(pty);
    await selectAndCopy(pty, 'copied text');
    expect(host.client.clipboardWriteText).toHaveBeenCalledWith({ text: 'copied text' });
    expect(inputOf(pty)).toEqual([]);
  });

  it.each([
    ['Cmd+V', true],
    ['Edit > Paste', false],
  ])(
    'pastes the copied text after Cmd+C, a task switch and %s with the copy still pending',
    async (_route, withShortcut) => {
      const source = createPty('source-task');
      await show(source);
      const finishCopy = holdNextCopy();
      await selectAndCopy(source, 'NEW');

      const destination = createPty('destination-task');
      await show(destination);
      if (withShortcut) expect(press(destination, 'v').defaultPrevented).toBe(false);
      // The browser read the system clipboard at the gesture, before the copy landed.
      dispatchPaste(destination, textTransfer('OLD'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(inputOf(destination)).toEqual([]);

      finishCopy();
      await vi.waitFor(() => expect(inputOf(destination)).toEqual([framed('NEW')]));
      expect(host.client.clipboardReadPaste).toHaveBeenCalledExactlyOnceWith({
        source: 'clipboard',
      });
      expect(inputOf(source)).toEqual([]);
    }
  );

  it('does not paste the old clipboard when the copy a browser paste waited for fails', async () => {
    const pty = createPty('failed-copy');
    await show(pty);
    const failCopy = holdNextCopy(false);
    await selectAndCopy(pty, 'NEW');
    dispatchPaste(pty, textTransfer('OLD'));
    pty.terminal.input('\r');
    failCopy();
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Typed input not sent', expect.anything())
    );
    expect(toast.error).toHaveBeenCalledWith(
      'Paste failed',
      expect.objectContaining({ description: expect.stringContaining('did not reach') })
    );
    expect(host.client.clipboardReadPaste).not.toHaveBeenCalled();
    expect(inputOf(pty)).toEqual([]);

    // Once the failure has settled, a new Cmd+V pastes what the clipboard still holds.
    dispatchPaste(pty, textTransfer('OLD'));
    await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('OLD')]));
  });

  it('pastes a copy queued behind a pending clipboard image snapshot', async () => {
    const pty = createPty('queued-copy');
    await show(pty);
    // An image paste whose payload exposes no file holds the clipboard sequence.
    const persisted = deferred<{ success: true; path: null }>();
    releases.push(() => persisted.resolve({ success: true, path: null }));
    host.client.persistClipboardImage.mockReturnValueOnce(persisted.promise);
    const image = new DataTransfer();
    image.setData('image/heic', 'not exposed as a file');
    dispatchPaste(pty, image);
    await vi.waitFor(() => expect(host.client.persistClipboardImage).toHaveBeenCalled());

    // The copy queues behind the snapshot, so the next paste event still carries OLD.
    await new Promise<void>((resolve) => pty.terminal.write('NEW', resolve));
    pty.terminal.select(0, 0, 'NEW'.length);
    press(pty, 'c');
    dispatchPaste(pty, textTransfer('OLD'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.client.clipboardWriteText).not.toHaveBeenCalled();

    persisted.resolve({ success: true, path: null });
    await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('NEW')]));
    expect(host.client.clipboardWriteText).toHaveBeenCalledWith({ text: 'NEW' });
  });
});

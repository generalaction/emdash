import { deferred } from '@emdash/shared/testing';
import type * as uiPrimitivesModule from '@emdash/ui/react/primitives';
import { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createConversationTerminalAttachments } from '@core/features/conversations/browser/terminal-attachments';
import { FrontendPty } from '@core/features/terminals/api/browser/pty/pty';
import { MAX_TERMINAL_PASTE_BYTES } from '@core/features/terminals/browser/pty/terminal-paste';
import type { PtyPane as PtyPaneType } from '@core/features/terminals/contributions/browser/pty/pty-pane';
import type {
  ClipboardPasteContent,
  DesktopHostEvent,
} from '@core/primitives/desktop-host/api/host-contract';

// Windows paste shortcuts are application-owned: they snapshot the system clipboard through
// the desktop host. Native DOM paste events (macOS, Edit > Paste) are exercised alongside them.

const upload = vi.hoisted(() => vi.fn());
const deleteAttachment = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }));
const openModal = vi.hoisted(() => vi.fn());
const host = vi.hoisted(() => {
  const state = {
    clipboard: '',
    image: null as string | null,
    eventHandlers: [] as { onEvent: (event: DesktopHostEvent) => void }[],
  };
  return {
    state,
    client: {
      events: {
        subscribe: async (
          _key: unknown,
          handlers: { onEvent: (event: DesktopHostEvent) => void }
        ) => {
          state.eventHandlers.push(handlers);
          return () => {};
        },
      },
      getPlatform: async () => 'win32',
      clipboardReadPaste: vi.fn(),
      clipboardWriteText: vi.fn(),
      persistClipboardImage: vi.fn(),
      persistDroppedBlob: vi.fn(),
      showTerminalContextMenu: vi.fn(),
    },
  };
});

const settingsGet = vi.hoisted(() => vi.fn(async () => ({}) as Record<string, unknown>));
vi.mock('@core/services/settings/api/client', () => ({
  getAppSettingsClient: async () => ({ get: settingsGet }),
}));
vi.mock('@core/primitives/wire/browser/connection', () => ({
  domainClient: async (domain: string) => {
    if (domain !== 'host') throw new Error(`Unexpected wire domain ${domain}`);
    return host.client;
  },
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
      delete: deleteAttachment,
    },
  }),
}));
vi.mock('@core/manifests/browser/modal-api', () => ({ openModal }));
vi.mock('@emdash/ui/react/primitives', async (importOriginal) => ({
  ...(await importOriginal<typeof uiPrimitivesModule>()),
  toast,
}));

let PtyPane: typeof PtyPaneType;

// navigator.platform is mocked for the app's shortcut policy; the user agent still names the
// OS whose Chromium keymap handles trusted key presses.
const MAC_HOST = /Mac OS X/.test(navigator.userAgent);

const BEGIN = '\x1b[200~';
const END = '\x1b[201~';

function framed(text: string): string {
  return BEGIN + text.replace(/\r?\n/g, '\r') + END;
}

function sample(length: number, multiline: boolean): string {
  const body = 'abcdefghijklmnopqrstuvwxyz0123456789_'.repeat(Math.ceil(length / 37) + 1);
  const text = body.slice(0, Math.max(0, length - 8)) + 'END_MARK';
  if (!multiline) return text.slice(-length);
  return text.replace(/.{79}/g, '$&\n').slice(0, length - 8) + 'END_MARK';
}

// Host clipboard operations run in one app-wide sequence, so a test that fails while holding
// one must still release it for the tests after it.
const releases: (() => void)[] = [];
function held<T>(fallback: T) {
  const operation = deferred<T>();
  releases.push(() => operation.resolve(fallback));
  return operation;
}

function snapshot(content: ClipboardPasteContent) {
  return { success: true as const, content };
}

function currentClipboard() {
  const { clipboard, image } = host.state;
  if (clipboard) return snapshot({ kind: 'text', text: clipboard });
  return snapshot(image ? { kind: 'image', path: image } : { kind: 'empty' });
}

function attachedPath(source: string): string {
  return `C:\\attachments\\${source.split(/[\\/]/).at(-1)}`;
}

type HarnessProps = {
  pty: FrontendPty;
  conversationId?: string;
  readOnly?: boolean;
  onEnterPress?: (message: string) => void;
  onFirstMessage?: (message: string) => void;
};

function Harness({ pty, conversationId = 'conversation-1', ...props }: HarnessProps) {
  const attachments = useMemo(
    () => createConversationTerminalAttachments(conversationId),
    [conversationId]
  );
  return (
    <div style={{ width: 800, height: 400 }}>
      <PtyPane
        pty={pty}
        sessionId={pty.sessionId}
        workspaceId="workspace"
        attachments={attachments}
        {...props}
      />
    </div>
  );
}

function keydown(pty: FrontendPty, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  pty.terminal.textarea?.dispatchEvent(event);
  return event;
}

const pressCtrlV = (pty: FrontendPty) => keydown(pty, { key: 'v', code: 'KeyV', ctrlKey: true });
const pressCtrlShiftV = (pty: FrontendPty) =>
  keydown(pty, { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });

function dispatchPaste(target: Element, data: DataTransfer): ClipboardEvent {
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: data,
  });
  target.dispatchEvent(event);
  return event;
}

function textTransfer(text: string): DataTransfer {
  const transfer = new DataTransfer();
  transfer.setData('text/plain', text);
  return transfer;
}

// Lets pending work run before asserting that something has not happened (yet). Positive
// results are awaited with vi.waitFor instead, since xterm parses output on later tasks.
async function flush(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 3; turn++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function writeOutput(pty: FrontendPty, data: string): Promise<void> {
  await new Promise<void>((resolve) => pty.terminal.write(data, resolve));
}

const setBracketedPaste = (pty: FrontendPty, enabled: boolean) =>
  writeOutput(pty, enabled ? '\x1b[?2004h' : '\x1b[?2004l');

describe('terminal clipboard paste through PtyPane and real xterm (Windows shortcuts)', () => {
  let root: Root;
  let mounted: boolean;
  let container: HTMLDivElement;
  let ptys: FrontendPty[];
  let inputs: Map<FrontendPty, string[]>;
  // The runtime's answer to each write; a test can hold it to keep that write unconfirmed.
  let delivery: (data: string) => boolean | Promise<boolean>;

  function createPty(
    sessionId: string,
    connect: (terminal: FrontendPty['terminal']) => () => void = () => () => {}
  ): FrontendPty {
    const input: string[] = [];
    const pty = new FrontendPty(sessionId, undefined, undefined, undefined, {
      connect,
      sendInput: async (data) => {
        input.push(data);
        return delivery(data);
      },
    });
    ptys.push(pty);
    inputs.set(pty, input);
    return pty;
  }

  const inputOf = (pty: FrontendPty) => inputs.get(pty) ?? [];

  async function render(props: HarnessProps): Promise<void> {
    await act(async () => root.render(<Harness {...props} />));
  }

  beforeAll(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    ({ PtyPane } = await import('@core/features/terminals/contributions/browser/pty/pty-pane'));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
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
    upload.mockImplementation(async (input: { sources: { path: string }[] }) => ({
      success: true,
      data: {
        id: `attachment-${input.sources[0].path}`,
        name: 'paste.png',
        mimeType: 'image/png',
        targetPath: attachedPath(input.sources[0].path),
        pathStyle: 'win32',
      },
    }));
    deleteAttachment.mockClear();
    toast.mockReset();
    toast.error.mockReset();
    openModal.mockReset();
    openModal.mockResolvedValue({ success: true, data: undefined });
    host.state.clipboard = '';
    host.state.image = null;
    host.state.eventHandlers = [];
    host.client.clipboardReadPaste.mockReset();
    host.client.clipboardReadPaste.mockImplementation(async () => currentClipboard());
    host.client.clipboardWriteText.mockReset();
    host.client.clipboardWriteText.mockImplementation(async ({ text }: { text: string }) => {
      host.state.clipboard = text;
      return { success: true };
    });
    host.client.persistClipboardImage.mockReset();
    host.client.persistClipboardImage.mockResolvedValue({ success: true, path: null });
    host.client.showTerminalContextMenu.mockReset();
    host.client.showTerminalContextMenu.mockResolvedValue({ success: true });
    vi.stubGlobal('electronAPI', { getPathForFile: () => '' });

    delivery = () => true;
    ptys = [];
    inputs = new Map();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(async () => {
    for (const release of releases.splice(0)) release();
    if (mounted) await act(async () => root.unmount());
    // Let xterm finish layout queued by reparenting before disposing its renderer.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    for (const pty of ptys) pty.dispose();
    container.remove();
    document.querySelector('[data-terminal-host="true"]')?.remove();
  });

  async function mountDestination(bracketed = true, props: Partial<HarnessProps> = {}) {
    const pty = createPty('destination');
    await render({ pty, ...props });
    await setBracketedPaste(pty, bracketed);
    pty.terminal.focus();
    return pty;
  }

  function terminalContainer(): HTMLElement {
    const element = container.querySelector<HTMLElement>('[data-terminal-container]');
    if (!element) throw new Error('Expected the terminal container to be mounted');
    return element;
  }

  describe('content and size', () => {
    const lengths = [1, 1023, 1024, 1399, 1400, 1401, 4095, 4096, 64 * 1024];

    it.each(lengths)('Ctrl+V sends a complete %i-character line in one frame', async (length) => {
      const pty = await mountDestination();
      host.state.clipboard = sample(length, false);
      expect(host.state.clipboard).toHaveLength(length);
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed(host.state.clipboard)]));
    });

    it.each(lengths.filter((length) => length > 80))(
      'Ctrl+V converts a %i-character multiline paste once, without submitting lines',
      async (length) => {
        const pty = await mountDestination();
        host.state.clipboard = sample(length, true);
        pressCtrlV(pty);
        await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed(host.state.clipboard)]));
        expect(inputOf(pty)[0].split(BEGIN)).toHaveLength(2);
        expect(inputOf(pty)[0].endsWith(`END_MARK${END}`)).toBe(true);
        expect(openModal).not.toHaveBeenCalled();
      }
    );

    it('normalizes a 1,400-character Windows CRLF clipboard to one CR per line', async () => {
      const pty = await mountDestination();
      const text = sample(1383, true).replace(/\n/g, '\r\n');
      expect(text).toHaveLength(1400);
      host.state.clipboard = text;
      pressCtrlShiftV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed(text)]));
      expect(inputOf(pty)[0]).not.toContain('\n');
    });

    it.each([
      ['whitespace', '\t  indented line  \n\n  trailing  \n'],
      ['mixed line endings', 'one\r\ntwo\nthree\rfour'],
      ['Unicode', 'é e\u0301 中文 🙂 👩‍💻 العربية'],
    ])('preserves %s exactly apart from line-break normalization', async (_name, text) => {
      const pty = await mountDestination();
      host.state.clipboard = text;
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed(text)]));
    });

    it('delivers 1 MiB through both the shortcut and a native paste event', async () => {
      const pty = await mountDestination();
      const text = sample(1024 * 1024, true);
      host.state.clipboard = text;
      pressCtrlV(pty);
      await flush();
      dispatchPaste(pty.terminal.textarea!, textTransfer(text));
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed(text), framed(text)]));
    });

    it('rejects a paste one byte over the admission limit without sending any of it', async () => {
      const pty = await mountDestination();
      host.state.clipboard = 'x'.repeat(MAX_TERMINAL_PASTE_BYTES - 1) + 'é';
      pressCtrlV(pty);
      await flush();
      expect(inputOf(pty)).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith('Paste too large', expect.anything());

      host.state.clipboard = 'x'.repeat(MAX_TERMINAL_PASTE_BYTES);
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed(host.state.clipboard)]));
    });

    it('pastes nothing for an empty clipboard', async () => {
      const pty = await mountDestination();
      pressCtrlV(pty);
      await flush();
      expect(inputOf(pty)).toEqual([]);
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('negotiated framing and control characters', () => {
    it('reads the destination mode at each paste', async () => {
      const pty = await mountDestination(true);
      host.state.clipboard = 'one';
      pressCtrlV(pty);
      await flush();
      await setBracketedPaste(pty, false);
      host.state.clipboard = 'two';
      pressCtrlV(pty);
      await flush();
      await setBracketedPaste(pty, true);
      host.state.clipboard = 'three';
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('one'), 'two', framed('three')]));
    });

    it.each([
      ['disables', true, false],
      ['enables', false, true],
    ])(
      'parses output that %s bracketed paste just before the paste',
      async (_name, before, after) => {
        const pty = await mountDestination(before);
        // Not awaited: the mode change is still queued in xterm when the paste arrives.
        pty.terminal.write(after ? '\x1b[?2004h' : '\x1b[?2004l');
        expect(pty.terminal.modes.bracketedPasteMode).toBe(before);
        dispatchPaste(pty.terminal.textarea!, textTransfer('first\nsecond'));
        await vi.waitFor(() =>
          expect(inputOf(pty)).toEqual([after ? framed('first\nsecond') : 'first\rsecond'])
        );
        expect(openModal).toHaveBeenCalledTimes(after ? 0 : 1);
      }
    );

    it('keeps embedded paste markers from ending the frame', async () => {
      const pty = await mountDestination();
      host.state.clipboard = 'head\x1b[201~\nbody\x1b[200~tail';
      pressCtrlV(pty);
      await vi.waitFor(() =>
        expect(inputOf(pty)).toEqual([`${BEGIN}head\u241b[201~\rbody\u241b[200~tail${END}`])
      );
      expect(inputOf(pty)[0].split(BEGIN)).toHaveLength(2);
      expect(inputOf(pty)[0].split(END)).toHaveLength(2);
    });

    it('applies the same guard, including C1 controls, to a native paste event', async () => {
      const pty = await mountDestination();
      const event = dispatchPaste(
        pty.terminal.textarea!,
        textTransfer('a\x1b[201~\x03\u009b201~b\u0085c')
      );
      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() =>
        expect(inputOf(pty)).toEqual([`${BEGIN}a\u241b[201~\u2403\u241b[201~b\u241bEc${END}`])
      );
    });

    it('shows controls instead of sending them as keys when bracketed paste is off', async () => {
      const pty = await mountDestination(false);
      host.state.clipboard = 'keep\x08\x7f\x03\x1b[Aend';
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(['keep\u2408\u2421\u2403\u241b[Aend']));
    });

    it('asks before sending an unframed multiline paste as Enter keystrokes', async () => {
      const pty = await mountDestination(false);
      host.state.clipboard = 'echo one\r\necho two\n';
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(['echo one\recho two\r']));
      expect(openModal).toHaveBeenCalledWith(
        'confirmActionModal',
        expect.objectContaining({ title: 'Paste as keystrokes?', confirmLabel: 'Paste' })
      );
    });

    it('treats a terminal that ignores bracketed paste as unframed', async () => {
      const pty = await mountDestination(true);
      pty.terminal.options.ignoreBracketedPasteMode = true;
      host.state.clipboard = 'line one\nline two';
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(['line one\rline two']));
      expect(openModal).toHaveBeenCalledOnce();
    });

    it('sends nothing and keeps the clipboard when the keystroke paste is cancelled', async () => {
      const pty = await mountDestination(false);
      openModal.mockResolvedValue({ success: false, error: { type: 'dismissed' } });
      host.state.clipboard = 'echo one\necho two';
      pressCtrlV(pty);
      await flush();
      expect(inputOf(pty)).toEqual([]);
      expect(host.state.clipboard).toBe('echo one\necho two');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('rereads the mode after confirmation', async () => {
      const pty = await mountDestination(false);
      const confirmation = deferred<{ success: true; data: undefined }>();
      openModal.mockReturnValue(confirmation.promise);
      host.state.clipboard = 'line one\nline two';
      pressCtrlV(pty);
      await flush();
      // Queued, unparsed output enables the mode while the dialog is open.
      pty.terminal.write('\x1b[?2004h');
      confirmation.resolve({ success: true, data: undefined });
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('line one\nline two')]));
    });

    it('waits for replayed output to be parsed before reading the mode', async () => {
      const pty = createPty('replaying', (terminal) => {
        terminal.write('$ \x1b[?2004h');
        return () => {};
      });
      await render({ pty });
      await pty.connect();
      expect(pty.terminal.modes.bracketedPasteMode).toBe(false);
      dispatchPaste(pty.terminal.textarea!, textTransfer('one\ntwo'));
      await flush();
      expect(openModal).not.toHaveBeenCalled();
      expect(inputOf(pty)).toEqual([framed('one\ntwo')]);
    });
  });

  describe('gesture ownership and ordering', () => {
    // Chromium's own paste accelerator for the OS running this test: Ctrl+V is application-
    // owned under the mocked Windows policy, while macOS Cmd+V stays browser-owned.
    const PASTE_KEYS = MAC_HOST ? '{Meta>}v{/Meta}' : '{Control>}v{/Control}';
    const COPY_KEYS = MAC_HOST ? '{Meta>}c{/Meta}' : '{Control>}c{/Control}';

    it(`commits a trusted ${MAC_HOST ? 'Cmd' : 'Ctrl'}+V exactly once`, async () => {
      const field = document.createElement('textarea');
      document.body.appendChild(field);
      const nativePastes: string[] = [];
      const countPaste = (event: ClipboardEvent) =>
        nativePastes.push(event.clipboardData?.getData('text/plain') ?? '');
      window.addEventListener('paste', countPaste, true);
      try {
        // Put text on the browser's own clipboard with its native copy accelerator, and
        // check that its native paste accelerator pastes into an ordinary text field.
        field.value = 'browser clipboard';
        field.focus();
        field.select();
        await userEvent.keyboard(COPY_KEYS);
        field.value = '';
        await userEvent.keyboard(PASTE_KEYS);
        expect(nativePastes).toEqual(['browser clipboard']);
        nativePastes.length = 0;

        const pty = await mountDestination();
        host.state.clipboard = 'system clipboard';
        await userEvent.keyboard(PASTE_KEYS);
        const pasted = MAC_HOST ? 'browser clipboard' : 'system clipboard';
        await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed(pasted)]));
        // Settle, then check that the gesture did not commit a second time.
        await flush();
        if (MAC_HOST) {
          expect(nativePastes).toEqual(['browser clipboard']);
          expect(host.client.clipboardReadPaste).not.toHaveBeenCalled();
          expect(inputOf(pty)).toEqual([framed('browser clipboard')]);
        } else {
          expect(nativePastes).toEqual([]);
          expect(host.client.clipboardReadPaste).toHaveBeenCalledOnce();
          expect(inputOf(pty)).toEqual([framed('system clipboard')]);
        }
      } finally {
        window.removeEventListener('paste', countPaste, true);
        field.remove();
      }
    });

    // Ctrl+Shift+V is a Windows and Linux paste accelerator only.
    it.skipIf(MAC_HOST)('commits a trusted Ctrl+Shift+V once without a browser paste', async () => {
      const nativePastes: Event[] = [];
      const countPaste = (event: Event) => nativePastes.push(event);
      window.addEventListener('paste', countPaste, true);
      try {
        const pty = await mountDestination();
        host.state.clipboard = 'once';
        await userEvent.keyboard('{Control>}{Shift>}V{/Shift}{/Control}');
        await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('once')]));
        await flush();
        expect(nativePastes).toHaveLength(0);
        expect(host.client.clipboardReadPaste).toHaveBeenCalledOnce();
        expect(inputOf(pty)).toEqual([framed('once')]);
      } finally {
        window.removeEventListener('paste', countPaste, true);
      }
    });

    it('sends keys typed during a pending clipboard read after the paste', async () => {
      const onEnterPress = vi.fn();
      const pty = await mountDestination(true, { onEnterPress });
      const read = held(snapshot({ kind: 'empty' }));
      host.client.clipboardReadPaste.mockReturnValueOnce(read.promise);
      pressCtrlV(pty);
      pty.terminal.input('X');
      pty.terminal.input('\r');
      await flush();
      expect(inputOf(pty)).toEqual([]);
      expect(onEnterPress).not.toHaveBeenCalled();

      read.resolve(snapshot({ kind: 'text', text: 'PASTE' }));
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('PASTE'), 'X', '\r']));
      // Submitted-input tracking saw the input in the order it was sent.
      expect(onEnterPress).toHaveBeenCalledExactlyOnceWith('PASTEX');

      pty.terminal.input('Y');
      expect(inputOf(pty).at(-1)).toBe('Y');
    });

    it('discards keys typed behind a paste the user declines', async () => {
      const pty = await mountDestination(false);
      const confirmation = deferred<{ success: false; error: { type: 'dismissed' } }>();
      openModal.mockReturnValue(confirmation.promise);
      const read = held(snapshot({ kind: 'empty' }));
      host.client.clipboardReadPaste.mockReturnValueOnce(read.promise);
      pressCtrlV(pty);
      pty.terminal.input('X');
      pty.terminal.input('\r');
      read.resolve(snapshot({ kind: 'text', text: 'rm -rf build\n' }));
      await vi.waitFor(() => expect(openModal).toHaveBeenCalledOnce());
      expect(inputOf(pty)).toEqual([]);
      confirmation.resolve({ success: false, error: { type: 'dismissed' } });
      await vi.waitFor(() =>
        expect(toast).toHaveBeenCalledWith('Typed input not sent', expect.anything())
      );
      expect(inputOf(pty)).toEqual([]);
      pty.terminal.input('Y');
      expect(inputOf(pty)).toEqual(['Y']);
    });

    it('discards keys typed behind a paste rejected as too large', async () => {
      const pty = await mountDestination();
      host.state.clipboard = 'x'.repeat(MAX_TERMINAL_PASTE_BYTES + 1);
      pressCtrlV(pty);
      pty.terminal.input('\r');
      await vi.waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Paste too large', expect.anything())
      );
      await flush();
      expect(inputOf(pty)).toEqual([]);
    });

    it('sends keys typed behind an empty clipboard paste', async () => {
      const pty = await mountDestination();
      pressCtrlV(pty);
      pty.terminal.input('X');
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(['X']));
    });

    it('commits two deliberate rapid pastes from different routes, in order', async () => {
      const pty = await mountDestination();
      const read = held(snapshot({ kind: 'empty' }));
      host.client.clipboardReadPaste.mockReturnValueOnce(read.promise);
      pressCtrlV(pty);
      dispatchPaste(pty.terminal.textarea!, textTransfer('second'));
      pressCtrlV(pty);
      host.state.clipboard = 'third';
      await flush();
      expect(inputOf(pty)).toEqual([]);
      read.resolve(snapshot({ kind: 'text', text: 'first' }));
      await vi.waitFor(() =>
        expect(inputOf(pty)).toEqual([framed('first'), framed('second'), framed('third')])
      );
    });

    function openContextMenu(pty: FrontendPty) {
      pty.ownedContainer.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
      );
    }

    function emitMenuAction(action: 'copy' | 'paste') {
      const [{ requestId }] = host.client.showTerminalContextMenu.mock.calls.at(-1) ?? [{}];
      for (const handlers of host.state.eventHandlers) {
        handlers.onEvent({ type: 'terminal-context-menu-action', requestId, action });
      }
    }

    it('routes context-menu Paste through the same conversion', async () => {
      const pty = await mountDestination();
      await flush();
      openContextMenu(pty);
      await flush();
      host.state.clipboard = 'from\nmenu';
      emitMenuAction('paste');
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('from\nmenu')]));
    });

    it('copies the menu selection snapshot after an earlier pending copy', async () => {
      const pty = await mountDestination();
      await writeOutput(pty, 'first line');
      pty.terminal.select(0, 0, 'first'.length);
      const earlier = held<void>(undefined);
      host.client.clipboardWriteText.mockImplementationOnce(async ({ text }: { text: string }) => {
        await earlier.promise;
        host.state.clipboard = text;
        return { success: true };
      });
      keydown(pty, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true });
      await flush();

      pty.terminal.select(6, 0, 'line'.length);
      openContextMenu(pty);
      await vi.waitFor(() =>
        expect(host.client.showTerminalContextMenu).toHaveBeenCalledWith(
          expect.objectContaining({ selectionText: 'line' })
        )
      );
      pty.terminal.clearSelection();
      emitMenuAction('copy');
      earlier.resolve();
      await vi.waitFor(() =>
        expect(host.client.clipboardWriteText.mock.calls).toEqual([
          [{ text: 'first' }],
          [{ text: 'line' }],
        ])
      );
      expect(host.state.clipboard).toBe('line');
    });

    it('routes a native copy event through the same ordered clipboard sequence once', async () => {
      const pty = await mountDestination();
      await writeOutput(pty, 'first line');
      pty.terminal.select(0, 0, 'first'.length);
      const earlier = held<void>(undefined);
      host.client.clipboardWriteText.mockImplementationOnce(async ({ text }: { text: string }) => {
        await earlier.promise;
        host.state.clipboard = text;
        return { success: true };
      });
      keydown(pty, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true });
      await flush();

      // Edit > Copy dispatches a DOM copy event at the focused terminal.
      pty.terminal.select(6, 0, 'line'.length);
      const data = new DataTransfer();
      const copy = new ClipboardEvent('copy', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      pty.terminal.textarea!.dispatchEvent(copy);
      expect(copy.defaultPrevented).toBe(true);
      // xterm's own copy listener did not also write the selection.
      expect(data.getData('text/plain')).toBe('');
      earlier.resolve();
      await vi.waitFor(() => expect(host.state.clipboard).toBe('line'));
      // Settle, then check that the copy was written once.
      await flush();
      expect(host.client.clipboardWriteText.mock.calls).toEqual([
        [{ text: 'first' }],
        [{ text: 'line' }],
      ]);
    });

    it('copies with Ctrl+C only when there is a selection, and interrupts otherwise', async () => {
      const pty = await mountDestination();
      keydown(pty, { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true });
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(['\x03']));
      expect(host.client.clipboardWriteText).not.toHaveBeenCalled();

      await writeOutput(pty, 'selected');
      pty.terminal.select(0, 0, 'selected'.length);
      keydown(pty, { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true });
      await vi.waitFor(() =>
        expect(host.client.clipboardWriteText).toHaveBeenCalledWith({ text: 'selected' })
      );
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(['\x03']));
      expect(host.client.clipboardWriteText).toHaveBeenCalledOnce();
    });

    it('reports a clipboard read failure instead of pasting nothing silently', async () => {
      const pty = await mountDestination();
      host.client.clipboardReadPaste.mockResolvedValue({ success: false, error: 'Access denied' });
      pressCtrlV(pty);
      await flush();
      expect(inputOf(pty)).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith(
        'Paste failed',
        expect.objectContaining({ description: expect.stringContaining('Access denied') })
      );
    });

    it('reports a paste the terminal did not confirm, without resending it', async () => {
      const pty = await mountDestination();
      delivery = () => false;
      host.state.clipboard = 'lost';
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('lost')]));
      expect(toast.error).toHaveBeenCalledWith('Paste not confirmed', expect.anything());
    });
  });

  describe('delivery results', () => {
    function holdPasteAnswer(matches: (data: string) => boolean) {
      const answer = held(false);
      delivery = (data) => (matches(data) ? answer.promise : true);
      return answer;
    }

    it.each([
      ['accepts', true],
      ['rejects', false],
    ] as const)(
      'holds keys typed behind a paste until the terminal %s that write',
      async (_name, accepted) => {
        const onEnterPress = vi.fn();
        const pty = await mountDestination(true, { onEnterPress });
        const answer = holdPasteAnswer((data) => data.startsWith(BEGIN));
        host.state.clipboard = 'PASTE';
        pressCtrlV(pty);
        pty.terminal.input('X');
        pty.terminal.input('\r');
        await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('PASTE')]));
        // A reply does not wait for the unanswered write; the typed keys do.
        await writeOutput(pty, '\x1b[5n');
        await flush();
        expect(inputOf(pty)).toEqual([framed('PASTE'), '\x1b[0n']);

        answer.resolve(accepted);
        if (accepted) {
          await vi.waitFor(() =>
            expect(inputOf(pty)).toEqual([framed('PASTE'), '\x1b[0n', 'X', '\r'])
          );
          expect(onEnterPress).toHaveBeenCalledExactlyOnceWith('PASTEX');
          return;
        }
        await vi.waitFor(() =>
          expect(toast).toHaveBeenCalledWith('Typed input not sent', expect.anything())
        );
        expect(toast.error).toHaveBeenCalledWith('Paste not confirmed', expect.anything());
        // Nothing is resent, and the held Enter cannot submit the incomplete prompt.
        expect(inputOf(pty)).toEqual([framed('PASTE'), '\x1b[0n']);
        expect(onEnterPress).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['accepts', true],
      ['rejects', false],
    ] as const)(
      'holds keys typed behind an attachment until the terminal %s its path',
      async (_name, accepted) => {
        const pty = await mountDestination();
        const answer = holdPasteAnswer((data) => data.includes('attachments'));
        host.state.image = 'C:\\t\\a.png';
        pressCtrlV(pty);
        pty.terminal.input('\r');
        const path = `${BEGIN}"C:\\attachments\\a.png" ${END}`;
        await vi.waitFor(() => expect(inputOf(pty)).toEqual([path]));
        await flush();
        expect(inputOf(pty)).toEqual([path]);

        answer.resolve(accepted);
        if (accepted) {
          await vi.waitFor(() => expect(inputOf(pty)).toEqual([path, '\r']));
          return;
        }
        await vi.waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith('Attachment not confirmed', expect.anything())
        );
        await vi.waitFor(() =>
          expect(toast).toHaveBeenCalledWith('Typed input not sent', expect.anything())
        );
        expect(inputOf(pty)).toEqual([path]);
        // The path may have arrived, so the prepared file is kept.
        expect(deleteAttachment).not.toHaveBeenCalled();
      }
    );

    it('does not refocus a terminal the user left while its paste was in flight', async () => {
      const pty = await mountDestination();
      const answer = holdPasteAnswer((data) => data.startsWith(BEGIN));
      host.state.clipboard = 'PASTE';
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('PASTE')]));
      const other = createPty('other-task');
      await render({ pty: other, conversationId: 'other' });
      other.terminal.focus();
      answer.resolve(true);
      await flush();
      expect(document.activeElement).toBe(other.terminal.textarea);
    });
  });

  describe('copies a paste depends on', () => {
    async function selectAndCopy(pty: FrontendPty, text: string) {
      await writeOutput(pty, `\r\x1b[2K${text}`);
      const row = pty.terminal.buffer.active.cursorY + pty.terminal.buffer.active.baseY;
      pty.terminal.select(0, row, text.length);
      keydown(pty, { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true });
    }

    function holdNextCopy(succeeds: boolean) {
      const written = held<void>(undefined);
      host.client.clipboardWriteText.mockImplementationOnce(async ({ text }: { text: string }) => {
        await written.promise;
        if (!succeeds) return { success: false, error: 'Clipboard busy' };
        host.state.clipboard = text;
        return { success: true };
      });
      return written;
    }

    it('stops a paste whose earlier copy failed, and discards the keys typed after it', async () => {
      host.state.clipboard = 'OLD';
      const pty = await mountDestination();
      const copy = holdNextCopy(false);
      await selectAndCopy(pty, 'NEW');
      pressCtrlV(pty);
      pty.terminal.input('X');
      pty.terminal.input('\r');
      copy.resolve();
      await vi.waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Paste failed',
          expect.objectContaining({
            description: expect.stringContaining('did not reach the clipboard'),
          })
        )
      );
      await vi.waitFor(() =>
        expect(toast).toHaveBeenCalledWith('Typed input not sent', expect.anything())
      );
      expect(toast.error).toHaveBeenCalledWith('Copy failed', expect.anything());
      expect(host.client.clipboardReadPaste).not.toHaveBeenCalled();
      expect(inputOf(pty)).toEqual([]);

      // A paste made after the failure has settled pastes the unchanged clipboard.
      pressCtrlV(pty);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('OLD')]));
    });

    it('keeps the snapshot a paste was invoked for when later copies queue', async () => {
      const pty = await mountDestination();
      const first = holdNextCopy(true);
      await selectAndCopy(pty, 'first');
      pressCtrlV(pty);
      await selectAndCopy(pty, 'second');
      first.resolve();
      await vi.waitFor(() => expect(inputOf(pty)).toEqual([framed('first')]));
      await vi.waitFor(() => expect(host.state.clipboard).toBe('second'));
      await flush();
      expect(inputOf(pty)).toEqual([framed('first')]);
    });
  });

  describe('terminal replies', () => {
    // Queries xterm answers while parsing output: DSR status, cursor position, DA1, DA2 and
    // DECRQSS for SGR. Exact replies from the installed xterm 6.
    const QUERIES = '\x1b[5n\x1b[6n\x1b[c\x1b[>c\x1bP$qm\x1b\\';
    const replies = [
      '\x1b[0n',
      expect.stringMatching(/^\x1b\[\d+;\d+R$/),
      '\x1b[?1;2c',
      '\x1b[>0;276;0c',
      '\x1bP1$r0m\x1b\\',
    ];
    const pressCtrlF3 = (pty: FrontendPty) =>
      keydown(pty, { key: 'F3', code: 'F3', keyCode: 114, ctrlKey: true });

    it('answers queries at once while a keystroke paste waits, and keeps them when it is declined', async () => {
      const onEnterPress = vi.fn();
      const pty = await mountDestination(false, { onEnterPress });
      const confirmation = deferred<{ success: false; error: { type: 'dismissed' } }>();
      openModal.mockReturnValue(confirmation.promise);
      dispatchPaste(pty.terminal.textarea!, textTransfer('echo one\necho two'));
      await vi.waitFor(() => expect(openModal).toHaveBeenCalledOnce());

      // Typed input, including a key whose sequence looks like a cursor report, stays held.
      pty.terminal.input('X');
      pressCtrlF3(pty);
      await writeOutput(pty, QUERIES);
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(replies));

      confirmation.resolve({ success: false, error: { type: 'dismissed' } });
      await vi.waitFor(() =>
        expect(toast).toHaveBeenCalledWith('Typed input not sent', {
          description: '2 keys typed after a paste that was not sent were discarded.',
        })
      );
      expect(inputOf(pty)).toEqual(replies);

      // The replies were not tracked as typing: the next line holds only what is typed.
      pty.terminal.input('hello\r');
      expect(onEnterPress).toHaveBeenCalledExactlyOnceWith('hello');
    });

    it('answers queries at once while an image paste is being prepared', async () => {
      const pty = await mountDestination();
      const uploaded = {
        success: true,
        data: {
          id: 'attachment-a',
          name: 'a.png',
          mimeType: 'image/png',
          targetPath: attachedPath('a.png'),
          pathStyle: 'win32',
        },
      };
      const preparing = held(uploaded);
      upload.mockReturnValueOnce(preparing.promise);
      host.state.image = 'C:\\t\\a.png';
      pressCtrlV(pty);
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
      pty.terminal.input('X');
      await writeOutput(pty, '\x1b[5n');
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(['\x1b[0n']));

      preparing.resolve(uploaded);
      await vi.waitFor(() =>
        expect(inputOf(pty)).toEqual(['\x1b[0n', `${BEGIN}"C:\\attachments\\a.png" ${END}`, 'X'])
      );
    });

    it('holds a response-shaped key behind a pending paste and sends it after', async () => {
      const pty = await mountDestination();
      pressCtrlF3(pty);
      expect(inputOf(pty)).toEqual(['\x1b[1;5R']);

      const read = held(snapshot({ kind: 'empty' }));
      host.client.clipboardReadPaste.mockReturnValueOnce(read.promise);
      pressCtrlV(pty);
      pressCtrlF3(pty);
      await flush();
      expect(inputOf(pty)).toEqual(['\x1b[1;5R']);
      read.resolve(snapshot({ kind: 'text', text: 'PASTE' }));
      await vi.waitFor(() =>
        expect(inputOf(pty)).toEqual(['\x1b[1;5R', framed('PASTE'), '\x1b[1;5R'])
      );
    });

    it('sends focus reports at once while a paste is pending', async () => {
      const pty = await mountDestination();
      // xterm reports the current focus as soon as mode 1004 is enabled.
      await writeOutput(pty, '\x1b[?1004h');
      expect(inputOf(pty)).toEqual(['\x1b[I']);
      const read = held(snapshot({ kind: 'empty' }));
      host.client.clipboardReadPaste.mockReturnValueOnce(read.promise);
      pressCtrlV(pty);
      pty.terminal.blur();
      pty.terminal.focus();
      await vi.waitFor(() => expect(inputOf(pty)).toEqual(['\x1b[I', '\x1b[O', '\x1b[I']));
      read.resolve(snapshot({ kind: 'text', text: 'PASTE' }));
      await vi.waitFor(() =>
        expect(inputOf(pty)).toEqual(['\x1b[I', '\x1b[O', '\x1b[I', framed('PASTE')])
      );
    });
  });

  describe('terminal settings', () => {
    const lateSettings = { fontSize: 22, fontFamily: 'Late Mono', macOptionIsMeta: true };

    it('applies terminal settings that arrive while the terminal is mounted', async () => {
      const settings = held<Record<string, unknown>>({});
      settingsGet.mockReturnValueOnce(settings.promise);
      const pty = createPty('mounted-settings');
      await render({ pty });
      settings.resolve(lateSettings);
      await vi.waitFor(() => expect(pty.terminal.options.fontSize).toBe(22));
      expect(pty.terminal.options.macOptionIsMeta).toBe(true);
    });

    it.each(['disposal', 'task replacement'] as const)(
      'ignores terminal settings that arrive after %s',
      async (change) => {
        const settings = held<Record<string, unknown>>({});
        settingsGet.mockReturnValueOnce(settings.promise);
        const pty = createPty('late-settings');
        await render({ pty });
        const { fontSize, fontFamily } = pty.terminal.options;
        const errors: unknown[] = [];
        const recordError = (event: ErrorEvent) => errors.push(event.error);
        window.addEventListener('error', recordError);
        try {
          if (change === 'disposal') pty.dispose();
          else await render({ pty: createPty('next-task'), conversationId: 'next' });
          settings.resolve(lateSettings);
          await flush();
          for (let frame = 0; frame < 3; frame++) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          expect(pty.terminal.options.fontSize).toBe(fontSize);
          expect(pty.terminal.options.fontFamily).toBe(fontFamily);
          expect(pty.terminal.options.macOptionIsMeta).toBe(false);
          expect(errors).toEqual([]);
        } finally {
          window.removeEventListener('error', recordError);
        }
      }
    );
  });

  describe('destination lifetime', () => {
    it.each(['task switch', 'read-only', 'unmount'] as const)(
      'cancels a pending paste and the keys typed after it on %s',
      async (change) => {
        const onEnterPress = vi.fn();
        const pty = await mountDestination(true, { onEnterPress });
        const read = held(snapshot({ kind: 'empty' }));
        host.client.clipboardReadPaste.mockReturnValueOnce(read.promise);
        pressCtrlV(pty);
        pty.terminal.input('X');
        pty.terminal.input('\r');
        await flush();
        const other = createPty('other-task');
        if (change === 'task switch') await render({ pty: other, conversationId: 'other' });
        else if (change === 'read-only') await render({ pty, readOnly: true });
        else {
          await act(async () => root.unmount());
          mounted = false;
        }
        await vi.waitFor(() =>
          expect(toast).toHaveBeenCalledWith('Typed input not sent', expect.anything())
        );
        expect(toast).toHaveBeenCalledWith('Paste cancelled', expect.anything());
        read.resolve(snapshot({ kind: 'text', text: 'late' }));
        await flush();
        // Neither the held paste nor the Enter typed to follow it reaches any terminal.
        expect(inputOf(pty)).toEqual([]);
        expect(inputOf(other)).toEqual([]);
        expect(onEnterPress).not.toHaveBeenCalled();
      }
    );

    it.each(['disposal', 'replacement'] as const)(
      'cancels a paste whose output parse is pending on terminal %s',
      async (change) => {
        const pty = await mountDestination(true);
        pty.terminal.write('\x1b[?2004l');
        dispatchPaste(pty.terminal.textarea!, textTransfer('one\ntwo'));
        // Let the commit reach its parse barrier; xterm parses on a later task.
        for (let step = 0; step < 5; step++) await Promise.resolve();
        expect(pty.terminal.modes.bracketedPasteMode).toBe(true);
        const next = createPty('next');
        if (change === 'disposal') pty.dispose();
        else await render({ pty: next, conversationId: 'next' });
        await vi.waitFor(() =>
          expect(toast).toHaveBeenCalledWith('Paste cancelled', expect.anything())
        );
        expect(openModal).not.toHaveBeenCalled();
        expect(inputOf(pty)).toEqual([]);

        // Nothing stays queued: the replacement terminal pastes and types normally.
        if (change === 'disposal') await render({ pty: next, conversationId: 'next' });
        await setBracketedPaste(next, true);
        dispatchPaste(next.terminal.textarea!, textTransfer('after'));
        await flush();
        next.terminal.input('Z');
        expect(inputOf(next)).toEqual([framed('after'), 'Z']);
      }
    );

    it('copies the real selection and pastes it after a task switch', async () => {
      const source = createPty('source');
      await render({ pty: source, conversationId: 'source' });
      const text = `${'wrapped-'.repeat(30)}END\n  indented\tline\nlast é🙂`;
      await writeOutput(source, text.replace(/\n/g, '\r\n'));
      const buffer = source.terminal.buffer.active;
      source.terminal.select(
        0,
        0,
        (buffer.baseY + buffer.cursorY) * source.terminal.cols + buffer.cursorX
      );
      const selection = source.terminal.getSelection();
      expect(selection.startsWith('wrapped-wrapped-')).toBe(true);
      expect(selection.split('\n')).toHaveLength(3);

      const write = held({ success: true as const });
      host.state.clipboard = 'stale clipboard';
      host.client.clipboardWriteText.mockImplementationOnce(async ({ text }: { text: string }) => {
        await write.promise;
        host.state.clipboard = text;
        return { success: true };
      });
      keydown(source, { key: 'c', code: 'KeyC', ctrlKey: true });

      const destination = createPty('destination');
      await render({ pty: destination, conversationId: 'destination' });
      await setBracketedPaste(destination, true);
      pressCtrlV(destination);
      await flush();
      expect(host.client.clipboardReadPaste).not.toHaveBeenCalled();
      write.resolve({ success: true });
      await vi.waitFor(() => expect(inputOf(destination)).toEqual([framed(selection)]));
      expect(host.client.clipboardWriteText).toHaveBeenCalledWith({ text: selection });
      expect(inputOf(source)).toEqual([]);
    });

    it('reports a failed copy', async () => {
      const pty = await mountDestination();
      await writeOutput(pty, 'copy me');
      pty.terminal.selectAll();
      host.client.clipboardWriteText.mockResolvedValue({ success: false, error: 'Busy' });
      keydown(pty, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true });
      await vi.waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Copy failed', expect.anything())
      );
    });
  });

  describe('attachments and submitted-input tracking', () => {
    it('pastes text from a rich payload instead of uploading its bitmap rendition', async () => {
      const pty = await mountDestination();
      const transfer = textTransfer('cell one\tcell two');
      transfer.setData('text/html', '<table><td>cell one</td></table>');
      transfer.items.add(new File(['png'], 'image.png', { type: 'image/png' }));
      dispatchPaste(terminalContainer(), transfer);
      await flush();
      expect(upload).not.toHaveBeenCalled();
      expect(inputOf(pty)).toEqual([framed('cell one\tcell two')]);
    });

    it('attaches the clipboard image snapshot when Ctrl+V finds no text', async () => {
      const pty = await mountDestination();
      host.state.image = 'C:\\t\\a.png';
      pressCtrlV(pty);
      await flush();
      expect(host.client.persistClipboardImage).not.toHaveBeenCalled();
      expect(inputOf(pty)).toEqual([`${BEGIN}"C:\\attachments\\a.png" ${END}`]);
    });

    it('keeps each gesture’s clipboard image when the clipboard changes before commit', async () => {
      const pty = await mountDestination(false);
      // An unframed multiline paste waits for confirmation and holds the later pastes.
      const confirmation = deferred<{ success: true; data: undefined }>();
      openModal.mockReturnValue(confirmation.promise);
      dispatchPaste(pty.terminal.textarea!, textTransfer('one\ntwo'));
      host.state.image = 'C:\\t\\a.png';
      pressCtrlV(pty);
      await flush();
      host.state.image = 'C:\\t\\b.png';
      pressCtrlV(pty);
      await vi.waitFor(() => expect(host.client.clipboardReadPaste).toHaveBeenCalledTimes(2));
      expect(upload).not.toHaveBeenCalled();

      confirmation.resolve({ success: true, data: undefined });
      await vi.waitFor(() =>
        expect(inputOf(pty)).toEqual([
          'one\rtwo',
          `${BEGIN}"C:\\attachments\\a.png" ${END}`,
          `${BEGIN}"C:\\attachments\\b.png" ${END}`,
        ])
      );
    });

    it('reports an attachment path the terminal did not confirm, without resending it', async () => {
      const pty = await mountDestination();
      delivery = (data) => !data.includes('attachments');
      host.state.image = 'C:\\t\\a.png';
      pressCtrlV(pty);
      await vi.waitFor(() =>
        expect(inputOf(pty)).toEqual([`${BEGIN}"C:\\attachments\\a.png" ${END}`])
      );
      expect(toast.error).toHaveBeenCalledWith('Attachment not confirmed', expect.anything());
      // The path may already have arrived, so the prepared file is kept.
      expect(deleteAttachment).not.toHaveBeenCalled();
    });

    it('records a framed multiline paste as one message when Enter is pressed', async () => {
      const onEnterPress = vi.fn();
      const onFirstMessage = vi.fn();
      const pty = createPty('tracked');
      await render({ pty, onEnterPress, onFirstMessage });
      await setBracketedPaste(pty, true);
      host.state.clipboard = 'Investigate the paste\nfailure on Windows';
      pressCtrlV(pty);
      await flush();
      expect(onEnterPress).not.toHaveBeenCalled();
      expect(onFirstMessage).not.toHaveBeenCalled();
      pty.terminal.input('\r');
      expect(onFirstMessage).toHaveBeenCalledExactlyOnceWith(
        'Investigate the paste\nfailure on Windows'
      );
      expect(onEnterPress).toHaveBeenCalledExactlyOnceWith(
        'Investigate the paste\nfailure on Windows'
      );
    });
  });
});

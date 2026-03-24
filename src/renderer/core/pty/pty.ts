import { CanvasAddon } from '@xterm/addon-canvas';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import { cssVar } from '../../lib/cssVars';
import { log } from '../../lib/logger';
import { events, rpc } from '../ipc';
import { ensureXtermHost } from './xterm-host';

const SCROLLBACK_LINES = 100_000;

// ── Theme helpers (previously in pty-pool.ts) ─────────────────────────────────

export interface SessionTheme {
  override?: ITerminalOptions['theme'];
}

export function readXtermCssVars(): ITerminalOptions['theme'] {
  return {
    background: cssVar('--xterm-bg'),
    foreground: cssVar('--xterm-fg'),
    cursor: cssVar('--xterm-cursor'),
    cursorAccent: cssVar('--xterm-cursor-accent'),
    selectionBackground: cssVar('--xterm-selection-bg'),
    selectionForeground: cssVar('--xterm-selection-fg'),
  };
}

export function buildTheme(theme?: SessionTheme): ITerminalOptions['theme'] {
  if (theme?.override) return { ...readXtermCssVars(), ...theme.override };
  return readXtermCssVars();
}

// ── FrontendPty ───────────────────────────────────────────────────────────────

/**
 * Frontend counterpart to the main-process Pty interface.
 *
 * Owns the xterm Terminal instance for the full lifetime of the session.
 * The terminal is created synchronously during construction, opened into a
 * pool-owned off-screen container, and subscribes to the PTY data IPC channel
 * immediately.  All live data is buffered in-memory until flushBuffer() is
 * called (after the historical ring-buffer fetch completes), which ensures
 * historical output always appears before live output.
 *
 * DOM management is handled via mount() / unmount():
 *  - mount()   → appends ownedContainer to the visible mount target
 *  - unmount() → moves ownedContainer back to the off-screen host
 *
 * Lifecycle: created once per conversation session in FrontendPtyRegistry.
 * Survives React component unmounts (e.g. navigating away from a task), and
 * is disposed only when the conversation is explicitly deleted.
 */
export class FrontendPty {
  readonly terminal: Terminal;
  readonly ownedContainer: HTMLDivElement;
  private _buffer: string | null = ''; // null = flushed, writes go direct
  private offData: () => void;

  constructor(sessionId: string, theme?: SessionTheme) {
    this.ownedContainer = document.createElement('div');
    Object.assign(this.ownedContainer.style, {
      width: '100%',
      height: '100%',
    });

    this.terminal = new Terminal({
      cols: 120,
      rows: 32,
      scrollback: SCROLLBACK_LINES,
      convertEol: true,
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      allowProposedApi: true,
      scrollOnUserInput: false,
      linkHandler: {
        activate: (_event: MouseEvent, text: string) => {
          rpc.app.openExternal(text).catch((error) => {
            log.warn('FrontendPty: failed to open external link', { text, error });
          });
        },
      },
      theme: buildTheme(theme),
    });

    const canvasAddon = new CanvasAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      rpc.app.openExternal(uri).catch(() => {});
    });

    this.terminal.loadAddon(canvasAddon);
    this.terminal.loadAddon(webLinksAddon);
    this.terminal.open(this.ownedContainer);

    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.backgroundColor = 'transparent';
    }

    ensureXtermHost().appendChild(this.ownedContainer);

    // Subscribe to live PTY data immediately. Buffer until flushBuffer() is
    // called so historical output can be prepended in the correct order.
    this.offData = events.on(
      ptyDataChannel,
      (data) => {
        if (typeof data !== 'string') return;
        if (this._buffer !== null) {
          this._buffer += data;
        } else {
          this.terminal.write(data);
        }
      },
      sessionId
    );
  }

  /**
   * Write historical output first, then any buffered live data that arrived
   * during the async getBuffer() fetch, then switch to direct writes.
   * Called once by FrontendPtyRegistry.register() after getBuffer() resolves.
   */
  flushBuffer(historical?: string): void {
    const pending = this._buffer ?? '';
    this._buffer = null;
    if (historical) this.terminal.write(historical);
    if (pending) this.terminal.write(pending);
  }

  /**
   * Append ownedContainer to a visible mount target.
   * If targetDims are provided the terminal is resized BEFORE the appendChild
   * to eliminate the flash caused by a post-mount resize.
   */
  mount(mountTarget: HTMLElement, targetDims?: { cols: number; rows: number }): void {
    if (
      targetDims &&
      (this.terminal.cols !== targetDims.cols || this.terminal.rows !== targetDims.rows)
    ) {
      this.terminal.resize(targetDims.cols, targetDims.rows);
    }
    mountTarget.appendChild(this.ownedContainer);
    // Force a Canvas2D repaint after reparenting in the DOM.
    const t = this.terminal;
    requestAnimationFrame(() => {
      try {
        if ((t as unknown as { _isDisposed?: boolean })._isDisposed) return;
        t.refresh(0, t.rows - 1);
      } catch {}
    });
  }

  /**
   * Move ownedContainer back to the off-screen host (tab deactivated /
   * TerminalPane unmounting).  Must be called after all ResizeObservers on
   * the visible mount target have been disconnected.
   */
  unmount(): void {
    ensureXtermHost().appendChild(this.ownedContainer);
  }

  /**
   * Permanently dispose this session (conversation deleted).
   * Unsubscribes from the IPC data channel, disposes the terminal, and
   * removes the owned container from the DOM.
   */
  dispose(): void {
    this.offData();
    this._buffer = null;
    try {
      this.terminal.dispose();
    } catch {}
    try {
      this.ownedContainer.remove();
    } catch {}
  }
}

// ── FrontendPtyRegistry ───────────────────────────────────────────────────────

/**
 * Module-level registry of FrontendPty instances, one per live conversation
 * session.  Lives outside React's lifecycle so terminals persist across
 * component unmounts (e.g. navigating away from a task and back).
 *
 * register() is async: it creates the FrontendPty (which immediately begins
 * buffering live IPC data), then awaits the historical ring-buffer fetch from
 * the main process, and calls flushBuffer() so historical output is written
 * before any live data.  By the time register() resolves, the terminal is
 * fully ready to mount.
 */
class FrontendPtyRegistry {
  private ptys = new Map<string, FrontendPty>();

  /**
   * Create and register a FrontendPty for the given session.  Returns
   * immediately if already registered (idempotent — safe in StrictMode).
   *
   * On first registration:
   *  1. Constructs FrontendPty (terminal created, IPC subscription active, buffering)
   *  2. Awaits rpc.pty.getBuffer() for any historical output
   *  3. Calls flushBuffer(historical) to write historical → live buffer → direct
   */
  async register(sessionId: string): Promise<void> {
    if (this.ptys.has(sessionId)) return;
    const pty = new FrontendPty(sessionId);
    this.ptys.set(sessionId, pty);

    const result = await rpc.pty.getBuffer(sessionId);
    pty.flushBuffer(result.success ? result.data.buffer : undefined);
  }

  /** Return the FrontendPty for the given session, or undefined. */
  get(sessionId: string): FrontendPty | undefined {
    return this.ptys.get(sessionId);
  }

  /** Dispose and remove the FrontendPty.  Called when a conversation is deleted. */
  unregister(sessionId: string): void {
    this.ptys.get(sessionId)?.dispose();
    this.ptys.delete(sessionId);
  }

  /** Dispose all registered sessions (called on app teardown). */
  disposeAll(): void {
    for (const pty of this.ptys.values()) {
      pty.dispose();
    }
    this.ptys.clear();
  }
}

export const frontendPtyRegistry = new FrontendPtyRegistry();

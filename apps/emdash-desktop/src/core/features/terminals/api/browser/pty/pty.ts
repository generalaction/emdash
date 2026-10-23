import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type IBufferRange, type ITerminalOptions } from '@xterm/xterm';
import {
  FileLinkProvider,
  isPrimaryMouseButton,
} from '@core/features/terminals/api/browser/pty/file-link-provider';
import { buildTerminalFontFamily } from '@core/features/terminals/api/browser/pty/terminal-font';
import { confirmOpenExternalLink } from '@core/features/workbench/api/browser/open-external-link';
import { copyTextToClipboard } from '@core/primitives/desktop-host/browser/host-client';
import { log } from '@core/primitives/logging/browser/logger';
import { cssColorToHex, cssVar } from '@core/primitives/styling/browser/cssVars';
import { decodeOsc52ClipboardData } from '../../../browser/pty/pty-clipboard';
import { isTerminalLinkAtMouseEvent } from '../../../browser/pty/terminal-context-link';
import { ensureXtermHost } from '../../../browser/pty/xterm-host';

/**
 * Task-terminal scrollback. The main side retains only 1 MB of output per PTY
 * session for replay, so deep scrollback never survives a restart anyway; 10k
 * lines is an order of magnitude beyond realistic scroll review and cuts the
 * dominant per-terminal memory cost ~10× versus the previous 100k.
 */
const SCROLLBACK_LINES = 10_000;

export const TERMINAL_PADDING_PX = 8;
// The DOM renderer cannot draw custom contiguous block glyphs. Keep xterm's
// default line height so ANSI block QR codes have no vertical seams.
export const TERMINAL_LINE_HEIGHT = 1;
export const TERMINAL_LETTER_SPACING = 0;

// ── Theme helpers ─────────────────────────────────────────────────────────────

export interface SessionTheme {
  override?: ITerminalOptions['theme'];
  /** Optional per-mount bottom inset; other sides retain the standard terminal padding. */
  paddingBottom?: number;
}

export type FrontendPtyConnector = {
  connect(terminal: Terminal): Promise<() => void> | (() => void);
  sendInput?(data: string): void;
  resize?(cols: number, rows: number): void;
};

export function readXtermCssVars(): ITerminalOptions['theme'] {
  const color = (name: string) => cssColorToHex(cssVar(name));
  return {
    background: color('--xterm-bg'),
    foreground: color('--xterm-fg'),
    cursor: color('--xterm-cursor'),
    cursorAccent: color('--xterm-cursor-accent'),
    selectionBackground: color('--xterm-selection-bg'),
    selectionForeground: color('--xterm-selection-fg'),
  };
}

function resolveOverride(override: NonNullable<ITerminalOptions['theme']>) {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(override)) {
    const varName =
      typeof value === 'string' ? /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1] : undefined;
    resolved[key] = varName ? cssColorToHex(cssVar(varName)) : value;
  }
  return resolved as ITerminalOptions['theme'];
}

export function buildTheme(theme?: SessionTheme): ITerminalOptions['theme'] {
  if (theme?.override) return { ...readXtermCssVars(), ...resolveOverride(theme.override) };
  return readXtermCssVars();
}

// ── FrontendPty ───────────────────────────────────────────────────────────────

type HoveredLink = { text: string; range: IBufferRange };

/**
 * Frontend counterpart to the main-process Pty interface.
 *
 * Owns the xterm Terminal instance for the full lifetime of the session.
 * The terminal is created synchronously during construction and opened into
 * an off-screen container. Call connect() to subscribe to the main-process
 * ring buffer and live IPC events — this writes historical output directly
 * to xterm and sets up ongoing data delivery without any renderer-side buffer.
 *
 * DOM management is handled via mount() / unmount():
 *  - mount()   → appends ownedContainer to the visible mount target
 *  - unmount() → moves ownedContainer back to the off-screen host
 *
 * Lifecycle: created and owned by PtySession (stores/pty-session.ts), one per
 * live session. Survives React component unmounts (e.g. navigating away from a
 * task), and is disposed only when the entity (terminal or conversation) is
 * explicitly deleted.
 */
export class FrontendPty {
  /** All live FrontendPty instances — used for app-wide operations (e.g. theme updates). */
  static readonly all = new Set<FrontendPty>();
  /** Lookup from session ID to live FrontendPty — used by the resize controller to fan out grid resizes. */
  static readonly bySession = new Map<string, FrontendPty>();
  readonly terminal: Terminal;
  readonly ownedContainer: HTMLDivElement;
  private theme?: SessionTheme;
  private offData: (() => void) | null = null;
  private hoveredOscLink: HoveredLink | null = null;
  private readonly linkMouseListeners = new AbortController();
  private cancelLinkClick: (() => void) | null = null;

  constructor(
    readonly sessionId: string,
    theme?: SessionTheme,
    onOpenFile?: (filePath: string) => void,
    onOpenExternal?: (filePath: string) => void,
    private readonly connector: FrontendPtyConnector = noopConnector()
  ) {
    this.theme = theme;
    this.ownedContainer = document.createElement('div');
    Object.assign(this.ownedContainer.style, {
      width: '100%',
      height: '100%',
    });
    ensureXtermHost().appendChild(this.ownedContainer);

    this.terminal = new Terminal({
      cols: 120,
      rows: 32,
      scrollback: SCROLLBACK_LINES,
      // NOTE: convertEol must stay false (the default). The PTY/app owns line
      // discipline; rewriting bare \n to \r\n corrupts raw-mode TUIs (tmux, claude
      // code) that use \n as "line feed, keep column" — yanking the cursor to
      // column 0 and mangling column alignment, while leaving plain shells fine.
      fontFamily: buildTerminalFontFamily(),
      fontSize: 13,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: TERMINAL_LETTER_SPACING,
      allowProposedApi: true,
      scrollOnUserInput: false,
      linkHandler: {
        activate: (event: MouseEvent, text: string) => {
          this.activateOscLink(event, text);
        },
        hover: (_event, text, range) => {
          this.hoveredOscLink = { text, range };
        },
        leave: () => {
          this.hoveredOscLink = null;
        },
      },
      theme: buildTheme(theme),
    });

    // Keep xterm on its DOM renderer: CanvasAddon repaints the full canvas on resize,
    // which makes panel/sidebar transitions visibly flicker.

    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (!isPrimaryMouseButton(event)) return;
      event.preventDefault();
      confirmOpenExternalLink(uri);
    });

    this.terminal.loadAddon(webLinksAddon);
    if (onOpenFile && onOpenExternal) {
      this.terminal.registerLinkProvider(
        new FileLinkProvider(this.terminal, onOpenFile, onOpenExternal)
      );
    }

    this.terminal.parser.registerOscHandler(52, (data) => {
      const text = decodeOsc52ClipboardData(data);
      if (text === null) return false;

      void copyTextToClipboard(text).catch((error) => {
        log.warn('FrontendPty: failed to write OSC 52 clipboard payload', { error });
      });
      return true;
    });

    this.terminal.open(this.ownedContainer);

    // xterm v6 insets .xterm-screen by padding on the .xterm element and subtracts
    // padding-left/padding-top in its coordinate math (getCoordsRelativeToElement),
    // so padding must live here — not on the parent ownedContainer.
    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.boxSizing = 'border-box';
      el.style.padding = `${TERMINAL_PADDING_PX}px`;
      this.applyElementTheme(theme);
      this.attachLinkClickShield(el);
    }

    FrontendPty.all.add(this);
    FrontendPty.bySession.set(this.sessionId, this);
  }

  getHoveredOscLink(event?: MouseEvent): string | null {
    const link = this.hoveredOscLink;
    if (!link || (event && !isTerminalLinkAtMouseEvent(this.terminal, event, link.range))) {
      return null;
    }
    return link.text;
  }

  private activateOscLink(event: MouseEvent, text: string): void {
    if (!isPrimaryMouseButton(event) || this.isForcedSelection(event)) return;
    // Let the release propagate: when xterm saw the press, its document listeners
    // must still finish the selection or mouse report.
    event.preventDefault();
    confirmOpenExternalLink(text, (error) => {
      log.warn('FrontendPty: failed to open external link', { text, error });
    });
  }

  private isForcedSelection(event: MouseEvent): boolean {
    // Match xterm's platform-specific override of application mouse reporting.
    return /Mac|iPod|iPhone|iPad/.test(navigator.platform)
      ? event.altKey && !!this.terminal.options.macOptionClickForcesSelection
      : event.shiftKey;
  }

  private attachLinkClickShield(element: HTMLElement): void {
    element.addEventListener(
      'mousedown',
      (event) => {
        if (!isPrimaryMouseButton(event)) return;
        if (this.terminal.modes.mouseTrackingMode === 'none' || this.isForcedSelection(event))
          return;
        // xterm only hovers http(s) OSC 8 links, so this matches what it would activate.
        const link = this.hoveredOscLink;
        if (!link || !this.getHoveredOscLink(event)) return;

        // Consuming the press also bypasses xterm's linkifier. Own the entire
        // gesture and activate on release, while keeping it out of the PTY.
        event.preventDefault();
        event.stopImmediatePropagation();
        this.terminal.focus();
        const gesture = new AbortController();
        const options = { capture: true, signal: gesture.signal };
        const cancel = () => {
          gesture.abort();
          this.cancelLinkClick = null;
        };
        this.cancelLinkClick = cancel;
        let dragged = false;
        const moved = (current: MouseEvent) =>
          Math.hypot(current.clientX - event.clientX, current.clientY - event.clientY) > 4;
        // If the release never reaches us, stop owning the pointer as soon as that
        // shows: on a move without the primary button, or on the next primary press
        // anywhere (this capture listener runs before the press is handled).
        element.ownerDocument.addEventListener(
          'mousedown',
          (press) => {
            if (isPrimaryMouseButton(press)) cancel();
          },
          options
        );
        element.ownerDocument.addEventListener(
          'mousemove',
          (move) => {
            if (!(move.buttons & 1)) {
              cancel();
              return;
            }
            dragged ||= moved(move);
            // No mouse-down was sent, so sending a drag would orphan the gesture.
            move.stopImmediatePropagation();
          },
          options
        );
        element.ownerDocument.addEventListener(
          'mouseup',
          (release) => {
            if (!isPrimaryMouseButton(release)) return;
            release.preventDefault();
            release.stopImmediatePropagation();
            cancel();
            if (
              !dragged &&
              !moved(release) &&
              this.hoveredOscLink &&
              isSameLink(this.hoveredOscLink, link) &&
              isTerminalLinkAtMouseEvent(this.terminal, release, link.range)
            ) {
              this.activateOscLink(release, link.text);
            }
          },
          options
        );
        element.ownerDocument.defaultView?.addEventListener('blur', cancel, options);
      },
      { capture: true, signal: this.linkMouseListeners.signal }
    );
  }

  setTheme(theme?: SessionTheme): void {
    this.theme = theme;
    this.terminal.options.theme = buildTheme(theme);
    this.applyElementTheme(theme);
  }

  refreshTheme(): void {
    this.terminal.options.theme = buildTheme(this.theme);
    this.applyElementTheme(this.theme);
  }

  private applyElementTheme(theme?: SessionTheme): void {
    const element = this.terminal.element;
    if (!element) return;
    element.style.paddingBottom = `${theme?.paddingBottom ?? TERMINAL_PADDING_PX}px`;
    element.style.backgroundColor = theme?.override?.background ?? 'var(--xterm-bg)';
  }

  clear(): void {
    this.terminal.clear();
    this.terminal.clearSelection();
  }

  /**
   * Subscribe to the runtime-backed retained output log and mark status as
   * ready once the connector has replayed its snapshot.
   */
  async connect(): Promise<void> {
    this.offData?.();
    this.offData = null;
    this.offData = await this.connector.connect(this.terminal);
  }

  sendInput(data: string): void {
    this.connector.sendInput?.(data);
  }

  resizeBackend(cols: number, rows: number): void {
    this.connector.resize?.(cols, rows);
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
    // Force a repaint after reparenting in the DOM.
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
   *
   * While parked, xterm's render service pauses itself: the host sits outside
   * the viewport, so the core IntersectionObserver reports zero intersection
   * and refreshes are skipped until the terminal is mounted again. The text
   * buffer stays intact for an instant, pixel-faithful restore.
   */
  unmount(): void {
    // Keep hoveredOscLink: it mirrors xterm's linkifier, which keeps its link across reparenting.
    this.cancelLinkClick?.();
    ensureXtermHost().appendChild(this.ownedContainer);
  }

  /**
   * Permanently dispose this session (terminal or conversation deleted).
   * Tears down the runtime output binding, disposes the xterm Terminal, and
   * removes the owned container from the DOM.
   */
  dispose(): void {
    FrontendPty.all.delete(this);
    FrontendPty.bySession.delete(this.sessionId);
    this.cancelLinkClick?.();
    this.linkMouseListeners.abort();
    this.hoveredOscLink = null;
    this.offData?.();
    this.offData = null;
    try {
      this.terminal.dispose();
    } catch {}
    try {
      this.ownedContainer.remove();
    } catch {}
  }
}

function noopConnector(): FrontendPtyConnector {
  return {
    connect() {
      return () => {};
    },
  };
}

// xterm recreates the hovered link whenever it repaints the link's rows, so
// compare by value, as its linkifier does before activating.
function isSameLink(a: HoveredLink, b: HoveredLink): boolean {
  const { start, end } = a.range;
  return (
    a.text === b.text &&
    start.x === b.range.start.x &&
    start.y === b.range.start.y &&
    end.x === b.range.end.x &&
    end.y === b.range.end.y
  );
}

// ── Session lookup ────────────────────────────────────────────────────────────

/** Returns the live FrontendPty for the given session ID, or undefined if not yet connected. */
export function getFrontendPty(sessionId: string): FrontendPty | undefined {
  return FrontendPty.bySession.get(sessionId);
}

// ── App-wide helpers ──────────────────────────────────────────────────────────

/** Apply a theme to all live terminals. Called on app-level theme change. */
export function applyThemeToAll(theme?: SessionTheme): void {
  for (const pty of FrontendPty.all) {
    if (theme) {
      pty.setTheme(theme);
    } else {
      pty.refreshTheme();
    }
  }
}

/** Dispose all live FrontendPty instances. Called on app teardown. */
export function disposeAllPtys(): void {
  for (const pty of [...FrontendPty.all]) {
    pty.dispose();
  }
}

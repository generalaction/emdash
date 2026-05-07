import { CanvasAddon } from '@xterm/addon-canvas';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import type { AppSettings } from '@shared/app-settings';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import { events, rpc } from '@renderer/lib/ipc';
import { cssVar } from '@renderer/utils/cssVars';
import { log } from '@renderer/utils/logger';
import { ensureXtermHost } from './xterm-host';

const SCROLLBACK_LINES = 100_000;
const DEFAULT_TERMINAL_FONT_FAMILY = 'Menlo, Monaco, Consolas, "Liberation Mono", monospace';

// Font setting cache.
// Cached so FrontendPty can apply the user's custom font in its constructor
// before connect() writes the historical buffer. Without this, the CanvasAddon
// builds its glyph atlas using the default font, then keeps stale metrics when
// fontFamily is mutated post-mount, producing the stretched / wrong-font look
// reported in old chats (ENG-1123).
let cachedFontFamily = DEFAULT_TERMINAL_FONT_FAMILY;
let prefetchPromise: Promise<void> | null = null;

// When a chosen fontFamily is not actually installed, the browser substitutes
// a proportional fallback (Times). xterm samples one glyph (e.g. 'W') to set
// the cell width, then narrow glyphs like 'i'/'l' get drawn in cells far wider
// than they are — that's the stretched look users see when they pick a font
// they don't have installed. Detect substitution via canvas measureText:
// render the candidate against three different generic fallbacks and keep it
// only if at least one width differs (a real font cannot match monospace,
// serif, AND sans-serif simultaneously).
const FONT_PROBE_TEXT = 'mwlioWMABCxyz0123';
const FONT_PROBE_SIZE = '72px';
const FONT_PROBE_FALLBACKS = ['monospace', 'serif', 'sans-serif'] as const;

export function isFontAvailable(fontFamily: string): boolean {
  const candidate = fontFamily.trim();
  if (!candidate) return false;
  if (typeof document === 'undefined') return false;
  const quoted = `"${candidate.replace(/"/g, '\\"')}"`;

  // Layer 1: FontFaceSet.check(). In Chromium this returns false for missing
  // system fonts and is the cheapest probe — but it is documented as best-effort
  // for system fonts, so a true result must still be corroborated below.
  try {
    if (typeof document.fonts?.check === 'function') {
      if (!document.fonts.check(`${FONT_PROBE_SIZE} ${quoted}`)) return false;
    }
  } catch {
    // ignore; rely on canvas probe
  }

  // Layer 2: canvas measureText probe. Real font cannot collide with all three
  // generic fallbacks; a substituted font matches whichever fallback caught it.
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    return false;
  }
  if (!ctx) return false;
  for (const fallback of FONT_PROBE_FALLBACKS) {
    ctx.font = `${FONT_PROBE_SIZE} ${fallback}`;
    const fallbackWidth = ctx.measureText(FONT_PROBE_TEXT).width;
    ctx.font = `${FONT_PROBE_SIZE} ${quoted}, ${fallback}`;
    const candidateWidth = ctx.measureText(FONT_PROBE_TEXT).width;
    if (Math.abs(candidateWidth - fallbackWidth) > 0.5) return true;
  }
  return false;
}

async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    await document.fonts?.ready;
  } catch {
    // ignore
  }
}

export function resolveTerminalFontFamily(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  if (!trimmed) return DEFAULT_TERMINAL_FONT_FAMILY;
  if (!isFontAvailable(trimmed)) {
    log.warn('FrontendPty: requested font is not available, falling back to default', {
      fontFamily: trimmed,
    });
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }
  return trimmed;
}

async function clearMissingFontFromSettings(current: AppSettings['terminal']): Promise<void> {
  // Remove the unusable saved font so the picker no longer shows
  // "Custom: <missing>" and the next launch does not re-trigger the warning.
  try {
    await rpc.appSettings.update('terminal', { ...current, fontFamily: '' });
  } catch (error) {
    log.warn('FrontendPty: failed to clear missing font from settings', { error });
  }
}

async function runTerminalSettingsPrefetch(self: { promise: Promise<void> | null }): Promise<void> {
  try {
    const terminalSettings = (await rpc.appSettings.get('terminal')) as AppSettings['terminal'];
    const requested = terminalSettings?.fontFamily?.trim() ?? '';
    // Wait for the browser font subsystem to be ready before probing —
    // measureText results can be unreliable on cold start otherwise.
    await fontsReady();
    const resolved = resolveTerminalFontFamily(requested);
    cachedFontFamily = resolved;
    if (terminalSettings && requested && resolved === DEFAULT_TERMINAL_FONT_FAMILY) {
      void clearMissingFontFromSettings(terminalSettings);
    }
  } catch (error) {
    log.warn('prefetchTerminalSettings: failed to load terminal settings', { error });
    // Allow the next caller to retry; otherwise a transient failure on the
    // module-load prefetch would leave every subsequent PTY constructed with
    // the default font for the rest of the app lifetime.
    if (prefetchPromise === self.promise) prefetchPromise = null;
  }
}

export function prefetchTerminalSettings(): Promise<void> {
  if (prefetchPromise) return prefetchPromise;
  const handle: { promise: Promise<void> | null } = { promise: null };
  const pending = runTerminalSettingsPrefetch(handle);
  handle.promise = pending;
  prefetchPromise = pending;
  return pending;
}

export function setCachedFontFamily(font: string): void {
  cachedFontFamily = resolveTerminalFontFamily(font);
}

// Theme helpers.

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

// FrontendPty.

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
  readonly terminal: Terminal;
  readonly ownedContainer: HTMLDivElement;
  private readonly canvasAddon: CanvasAddon;
  private offData: (() => void) | null = null;
  /** Last { cols, rows } sent to rpc.pty.resize(). Used by PaneSizingContext to skip redundant IPC calls. */
  lastSentDims: { cols: number; rows: number } | null = null;

  constructor(
    readonly sessionId: string,
    theme?: SessionTheme
  ) {
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
      fontFamily: cachedFontFamily,
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

    this.canvasAddon = new CanvasAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      rpc.app.openExternal(uri).catch(() => {});
    });

    this.terminal.loadAddon(this.canvasAddon);
    this.terminal.loadAddon(webLinksAddon);
    this.terminal.open(this.ownedContainer);

    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.backgroundColor = 'transparent';
    }

    ensureXtermHost().appendChild(this.ownedContainer);
    FrontendPty.all.add(this);
  }

  /**
   * Subscribe to the session: fetches the ring buffer from the main process,
   * writes it directly to xterm, then sets up a live IPC listener for future
   * data. Marks status as 'ready' once complete.
   *
   * The main process guarantees atomicity: subscribe() snapshots the ring
   * buffer and registers the consumer in one synchronous tick, so no data
   * can slip between the snapshot and the first live IPC event.
   */
  async connect(): Promise<void> {
    const result = await rpc.pty.subscribe(this.sessionId);
    const historical = result.success ? result.data.buffer : '';
    if (historical) this.terminal.write(historical);
    this.offData = events.on(
      ptyDataChannel,
      (data: string) => {
        this.terminal.write(data);
      },
      this.sessionId
    );
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
   * Update the terminal's font family and invalidate the CanvasAddon's glyph
   * texture atlas. Without clearing the atlas, glyphs cached at the old font
   * metrics keep being painted, producing the stretched / wrong-font look in
   * scrollback that was already rendered before the font change (ENG-1123).
   */
  setFontFamily(fontFamily: string): void {
    const resolved = resolveTerminalFontFamily(fontFamily);
    if (this.terminal.options.fontFamily === resolved) return;
    this.terminal.options.fontFamily = resolved;
    try {
      this.canvasAddon.clearTextureAtlas();
      this.terminal.clearTextureAtlas();
      this.terminal.refresh(0, this.terminal.rows - 1);
    } catch (error) {
      log.warn('FrontendPty: font refresh failed', { error });
    }
  }

  /**
   * Permanently dispose this session (terminal or conversation deleted).
   * Unsubscribes from the main process, tears down the IPC data listener,
   * disposes the xterm Terminal, and removes the owned container from the DOM.
   */
  dispose(): void {
    FrontendPty.all.delete(this);
    this.offData?.();
    this.offData = null;
    rpc.pty.unsubscribe(this.sessionId).catch(() => {});
    try {
      this.terminal.dispose();
    } catch {}
    try {
      this.ownedContainer.remove();
    } catch {}
  }
}

// App-wide helpers.

/** Apply a theme to all live terminals. Called on app-level theme change. */
export function applyThemeToAll(theme?: SessionTheme): void {
  const xTermTheme = buildTheme(theme);
  for (const pty of FrontendPty.all) {
    pty.terminal.options.theme = xTermTheme;
  }
}

/** Dispose all live FrontendPty instances. Called on app teardown. */
export function disposeAllPtys(): void {
  for (const pty of [...FrontendPty.all]) {
    pty.dispose();
  }
}

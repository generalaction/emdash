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

// Applied at construction so historical scrollback renders with the user's
// font instead of being patched after xterm has already measured glyphs.
let cachedFontFamily = DEFAULT_TERMINAL_FONT_FAMILY;
let installedFontNames: Set<string> | null = null;
let prefetchPromise: Promise<void> | null = null;

export function resolveTerminalFontFamily(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  if (!trimmed) return DEFAULT_TERMINAL_FONT_FAMILY;
  const resolved = `${quoteFontFamily(trimmed)}, ${DEFAULT_TERMINAL_FONT_FAMILY}`;
  if (!installedFontNames || isFontFamilyInstalled(trimmed, installedFontNames)) return resolved;
  log.warn('FrontendPty: requested font was not found in the OS font list', {
    fontFamily: trimmed,
  });
  return resolved;
}

function quoteFontFamily(fontFamily: string): string {
  if (fontFamily.includes(',') || isGenericFontFamily(fontFamily)) return fontFamily;
  return `"${fontFamily.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isGenericFontFamily(fontFamily: string): boolean {
  const normalized = fontFamily.trim().toLowerCase();
  return normalized === 'monospace' || normalized === 'serif' || normalized === 'sans-serif';
}

function isFontFamilyInstalled(fontFamily: string, installed: Set<string>): boolean {
  const primaryFamily = fontFamily
    .split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
  if (!primaryFamily) return false;
  if (isGenericFontFamily(primaryFamily)) return true;
  return installed.has(primaryFamily);
}

async function runTerminalSettingsPrefetch(): Promise<void> {
  try {
    const [terminalSettings, fontsResult] = await Promise.all([
      rpc.appSettings.get('terminal') as Promise<AppSettings['terminal']>,
      rpc.app.listInstalledFonts(),
    ]);
    if (fontsResult.success) {
      installedFontNames = new Set(fontsResult.fonts.map((font) => font.trim().toLowerCase()));
    }
    cachedFontFamily = resolveTerminalFontFamily(terminalSettings?.fontFamily?.trim() ?? '');
  } catch (error) {
    log.warn('prefetchTerminalSettings: failed to load terminal settings', { error });
    prefetchPromise = null;
  }
}

export function prefetchTerminalSettings(): Promise<void> {
  if (!prefetchPromise) prefetchPromise = runTerminalSettingsPrefetch();
  return prefetchPromise;
}

export function setCachedFontFamily(font: string): void {
  cachedFontFamily = resolveTerminalFontFamily(font);
}

// ── Theme helpers ─────────────────────────────────────────────────────────────

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
  private theme?: SessionTheme;
  private offData: (() => void) | null = null;
  /** Last { cols, rows } sent to rpc.pty.resize(). Used by PaneSizingContext to skip redundant IPC calls. */
  lastSentDims: { cols: number; rows: number } | null = null;

  constructor(
    readonly sessionId: string,
    theme?: SessionTheme
  ) {
    this.theme = theme;
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

    // Keep xterm on its DOM renderer: CanvasAddon repaints the full canvas on resize,
    // which makes panel/sidebar transitions visibly flicker.

    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      rpc.app.openExternal(uri).catch(() => {});
    });

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

  setTheme(theme?: SessionTheme): void {
    this.theme = theme;
    this.terminal.options.theme = buildTheme(theme);
  }

  refreshTheme(): void {
    this.terminal.options.theme = buildTheme(this.theme);
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

  setFontFamily(fontFamily: string): void {
    const resolved = resolveTerminalFontFamily(fontFamily);
    if (this.terminal.options.fontFamily === resolved) return;
    this.terminal.options.fontFamily = resolved;
    this.terminal.clearTextureAtlas();
    this.terminal.refresh(0, this.terminal.rows - 1);
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

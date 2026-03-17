import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { cssVar } from '../../lib/cssVars';
import { log } from '../../lib/logger';
import { rpc } from '../ipc';
import { ensureXtermHost } from './xterm-host';

export const MAX_POOL_SIZE = 16;
const SCROLLBACK_LINES = 100_000;

export interface SessionTheme {
  override?: ITerminalOptions['theme'];
}

export interface LeaseOptions {
  theme?: SessionTheme;
  /**
   * If provided the terminal is resized to these dimensions BEFORE being
   * appended to the visible mount-target.  This eliminates the flash caused by
   * terminal.resize() firing after the canvas is already visible.
   */
  targetDims?: { cols: number; rows: number };
}

export interface LeaseResult {
  terminal: Terminal;
}

/**
 * Unbound terminal instance pre-warmed and parked off-screen, ready to be
 * claimed by any session.  The WebGL context is already initialised so lease()
 * is instant when a spare is available.
 */
interface SpareEntry {
  ownedContainer: HTMLDivElement;
  terminal: Terminal;
  serializeAddon: SerializeAddon;
  webglAddon: WebglAddon | null;
}

/** Spare entry that has been bound to a session. */
interface PoolEntry extends SpareEntry {
  lastUsedAt: number;
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

/**
 * Pool of up to MAX_POOL_SIZE xterm.js Terminal instances, each backed by a
 * pool-owned DOM container.  Terminals are never destroyed on tab-switch — they
 * are reparented between the visible mount-target and the off-screen host
 * (terminalHost.ts).
 *
 * Spare (unbound) instances are kept equal to the number of active sessions
 * (the "2x" rule), capped so the total never exceeds MAX_POOL_SIZE.  Spares
 * are created one-at-a-time in setTimeout(0) so they never block rendering.
 *
 * When the pool is full and a new session is needed, the LRU entry is serialized
 * via SerializeAddon and disposed; its scrollback is replayed when next leased.
 */
class TerminalPool {
  private entries = new Map<string, PoolEntry>();
  private spares: SpareEntry[] = [];
  private snapshots = new Map<string, string>();
  private spareCreationPending = false;

  // ── Core allocation helpers ─────────────────────────────────────────────────

  /**
   * How many spare instances we should maintain.
   * Formula: min(active, MAX_POOL_SIZE - active)
   * - Maintains 1:1 parity between active and spare slots.
   * - Naturally caps at MAX_POOL_SIZE/2 spare slots when the pool is full.
   */
  private targetSpareCount(): number {
    const active = this.entries.size;
    return Math.min(active, MAX_POOL_SIZE - active);
  }

  /**
   * Schedule creation of spare terminals until the target is reached.
   * Creates one per event-loop tick to keep the main thread responsive.
   */
  private ensureSpares(): void {
    const needed = this.targetSpareCount() - this.spares.length;
    if (needed <= 0) return;
    if (this.spareCreationPending) return;
    this.spareCreationPending = true;

    setTimeout(() => {
      this.spareCreationPending = false;
      const stillNeeded = this.targetSpareCount() - this.spares.length;
      if (stillNeeded <= 0) return;

      try {
        const spare = this.buildCore({});
        ensureXtermHost().appendChild(spare.ownedContainer);
        this.spares.push(spare);
      } catch (e) {
        log.warn('TerminalPool: failed to pre-warm spare terminal', { error: e });
      }

      // Recurse to create the next spare if still needed.
      this.ensureSpares();
    }, 0);
  }

  /**
   * Create the core xterm.js infrastructure (Terminal + addons + ownedContainer).
   * Does NOT insert the container into the document; callers handle placement.
   */
  private buildCore(
    options: { theme?: SessionTheme; cols?: number; rows?: number },
    snapshot?: string
  ): SpareEntry {
    const { theme, cols = 120, rows = 32 } = options;

    const ownedContainer = document.createElement('div');
    Object.assign(ownedContainer.style, {
      width: '100%',
      height: '100%',
    });

    const terminal = new Terminal({
      cols,
      rows,
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
            log.warn('TerminalPool: failed to open external link', { text, error });
          });
        },
      },
      theme: buildTheme(theme),
    });

    const serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      rpc.app.openExternal(uri).catch(() => {});
    });

    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(webLinksAddon);

    // SpareEntry is the stable reference that the context-loss handler closes over.
    const entry: SpareEntry = {
      ownedContainer,
      terminal,
      serializeAddon,
      webglAddon: null,
    };

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss?.(() => {
        try {
          webglAddon.dispose();
        } catch {}
        entry.webglAddon = null;
      });
      terminal.loadAddon(webglAddon);
      entry.webglAddon = webglAddon;
    } catch {}

    terminal.open(ownedContainer);
    const el = (terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      // Make the .xterm element's background transparent so any pixel gap between
      // the last canvas row and the bottom of the container shows the outer
      // wrapper's background (which uses var(--xterm-bg)) rather than xterm's
      // internal background color.  This prevents a visible bar when the two
      // colors would otherwise differ (e.g. ultra-dark theme vs fallback gray).
      el.style.backgroundColor = 'transparent';
    }

    if (snapshot) {
      try {
        terminal.write(snapshot);
      } catch (e) {
        log.warn('TerminalPool: failed to replay snapshot', { error: e });
      }
    }

    return entry;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Attach a terminal to `mountTarget`.
   *
   * Fast path (existing entry): reparents the pool-owned container.
   * Warm path (spare available): claims a pre-warmed spare, applies theme /
   *   snapshot, binds to `sessionId` — WebGL already initialised.
   * Cold path (no spare, not at cap): builds a new terminal synchronously.
   * Eviction path (at cap): serializes LRU, disposes it, then warm/cold path.
   *
   * If `targetDims` is provided, the terminal is resized to those dimensions
   * BEFORE being appended to the visible DOM, eliminating the flash from a
   * post-mount resize.
   *
   * Calls `ensureSpares()` after every new-entry path to replenish the spare
   * pool asynchronously.
   */
  lease(sessionId: string, mountTarget: HTMLElement, options: LeaseOptions = {}): LeaseResult {
    const { theme, targetDims } = options;

    // ── Re-lease: terminal already in the pool ────────────────────────────────
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      existing.terminal.options.theme = buildTheme(theme);
      if (
        targetDims &&
        (existing.terminal.cols !== targetDims.cols || existing.terminal.rows !== targetDims.rows)
      ) {
        existing.terminal.resize(targetDims.cols, targetDims.rows);
      }
      mountTarget.appendChild(existing.ownedContainer);
      // Force a WebGL repaint regardless of whether dimensions changed.
      // Without this the canvas stays blank after being reparented in the DOM.
      // Guard against the terminal being disposed before the frame fires.
      const t = existing.terminal;
      requestAnimationFrame(() => {
        try {
          if ((t as unknown as { _isDisposed?: boolean })._isDisposed) return;
          t.refresh(0, t.rows - 1);
        } catch {}
      });
      return { terminal: existing.terminal };
    }

    // ── Need a new entry ──────────────────────────────────────────────────────

    // Evict LRU when every slot is taken by active entries (no spares left).
    if (this.entries.size >= MAX_POOL_SIZE) {
      this.evictLRU();
    }

    const snapshot = this.snapshots.get(sessionId);
    if (snapshot) this.snapshots.delete(sessionId);

    let entry: PoolEntry;

    const spare = this.spares.pop();
    if (spare) {
      // Warm path: claim a pre-warmed spare.
      spare.terminal.options.theme = buildTheme(theme);
      if (snapshot) {
        try {
          spare.terminal.write(snapshot);
        } catch (e) {
          log.warn('TerminalPool: failed to replay snapshot onto spare', { sessionId, error: e });
        }
      }
      // SpareEntry and PoolEntry share the same object reference — context-loss
      // handler closures remain valid after adding lastUsedAt.
      (spare as PoolEntry).lastUsedAt = Date.now();
      entry = spare as PoolEntry;
    } else {
      // Cold path: build a new terminal synchronously.
      const core = this.buildCore({ theme }, snapshot);
      (core as PoolEntry).lastUsedAt = Date.now();
      entry = core as PoolEntry;
    }

    if (
      targetDims &&
      (entry.terminal.cols !== targetDims.cols || entry.terminal.rows !== targetDims.rows)
    ) {
      entry.terminal.resize(targetDims.cols, targetDims.rows);
    }

    this.entries.set(sessionId, entry);
    mountTarget.appendChild(entry.ownedContainer);
    // Force a WebGL repaint (see re-lease path above for rationale).
    // Guard against the terminal being disposed before the frame fires.
    const t = entry.terminal;
    requestAnimationFrame(() => {
      try {
        if ((t as unknown as { _isDisposed?: boolean })._isDisposed) return;
        t.refresh(0, t.rows - 1);
      } catch {}
    });

    // Replenish the spare pool in the background.
    this.ensureSpares();

    return { terminal: entry.terminal };
  }

  /**
   * Detach the terminal from its current parent and park it in the off-screen
   * host.  Must be called before the mount-target is removed from the DOM so
   * the ResizeObserver disconnect happens first (caller's responsibility).
   */
  release(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.lastUsedAt = Date.now();
    ensureXtermHost().appendChild(entry.ownedContainer);
  }

  /** Fully destroy a session's terminal (e.g. when a conversation is deleted). */
  dispose(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.disposeEntry(entry);
    this.entries.delete(sessionId);
    this.snapshots.delete(sessionId);
    // Trim excess spares since active count dropped.
    this.trimSpares();
  }

  disposeAll(): void {
    for (const [, entry] of this.entries) {
      this.disposeEntry(entry);
    }
    this.entries.clear();
    for (const spare of this.spares) {
      this.disposeEntry(spare);
    }
    this.spares = [];
    this.snapshots.clear();
    this.spareCreationPending = false;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastUsedAt < lruTime) {
        lruTime = entry.lastUsedAt;
        lruKey = key;
      }
    }
    if (!lruKey) return;
    const entry = this.entries.get(lruKey)!;
    try {
      this.snapshots.set(lruKey, entry.serializeAddon.serialize());
    } catch (e) {
      log.warn('TerminalPool: failed to serialize evicted terminal', {
        sessionId: lruKey,
        error: e,
      });
    }
    this.disposeEntry(entry);
    this.entries.delete(lruKey);
  }

  /** Remove and dispose the youngest spares until spares.length <= target. */
  private trimSpares(): void {
    const target = this.targetSpareCount();
    while (this.spares.length > target) {
      const spare = this.spares.pop();
      if (spare) this.disposeEntry(spare);
    }
  }

  private disposeEntry(entry: SpareEntry): void {
    try {
      entry.webglAddon?.dispose();
    } catch {}
    try {
      entry.terminal.dispose();
    } catch {}
    try {
      entry.ownedContainer.remove();
    } catch {}
  }
}

export const terminalPool = new TerminalPool();

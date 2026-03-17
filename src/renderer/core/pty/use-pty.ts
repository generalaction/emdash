import { Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { AppSettings } from '@shared/app-settings';
import { appPasteChannel } from '@shared/events/appEvents';
import { ptyDataChannel, ptyExitChannel } from '@shared/events/ptyEvents';
import { log } from '../../lib/logger';
import { pendingInjectionManager } from '../../lib/PendingInjectionManager';
import { events, rpc } from '../ipc';
import { panelDragStore } from '../view/panel-drag-store';
import { usePaneSizingContext } from './pane-sizing-context';
import { frontendPtyRegistry } from './pty';
import { measureDimensions } from './pty-dimensions';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  shouldCopySelectionFromTerminal,
  shouldKillLineFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
} from './pty-keybindings';
import { buildTheme, type SessionTheme } from './pty-pool';
import { useTerminalPool } from './pty-pool-provider';

// xterm's proposed API and internal fields are not in the public TypeScript
// types. Both code paths are necessary: the proposed `dimensions` API works in
// xterm 5.x, while xterm 6.x exposes cell metrics only via `_core`.
interface XtermCellDimensions {
  css: { cell: { width: number; height: number } };
}
interface XtermInternals {
  dimensions?: XtermCellDimensions;
  _core?: {
    _renderService?: { dimensions?: XtermCellDimensions };
    renderService?: { dimensions?: XtermCellDimensions };
  };
}

function getCellMetrics(terminal: Terminal): { width: number; height: number } | null {
  const t = terminal as unknown as XtermInternals;
  // Proposed API (xterm 5.x). Undefined on the public Terminal in xterm 6.x.
  const dims = t.dimensions;
  if (dims && dims.css.cell.width !== 0 && dims.css.cell.height !== 0) {
    return { width: dims.css.cell.width, height: dims.css.cell.height };
  }
  // xterm 6.x: the public Terminal delegates to `_core` (the internal Terminal instance).
  // FitAddon receives this same internal object via addon.activate(terminal).
  const coreDims = t._core?._renderService?.dimensions ?? t._core?.renderService?.dimensions;
  if (coreDims?.css?.cell?.width && coreDims.css.cell.height) {
    return { width: coreDims.css.cell.width, height: coreDims.css.cell.height };
  }
  return null;
}

const PTY_RESIZE_DEBOUNCE_MS = 60;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;
const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export interface UsePtyOptions {
  /** Deterministic PTY session ID: makePtySessionId(projectId, taskId, conversationId|terminalId) */
  sessionId: string;
  theme?: SessionTheme;
  mapShiftEnterToCtrlJ?: boolean;
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
}

export interface UseTerminalReturn {
  focus: () => void;
  setTheme: (theme: SessionTheme) => void;
}

/**
 * React hook that manages a full xterm.js terminal instance attached to
 * `containerRef`, wired to a PTY session via the deterministic `sessionId`.
 *
 * Terminal instances are leased from the global TerminalPool (max 16 WebGL
 * contexts).  On unmount the terminal is returned to the pool's off-screen
 * host rather than disposed, so scrollback is preserved across tab switches.
 *
 * Data routing depends on whether a FrontendPty is registered for the session:
 *  - Conversation sessions: FrontendPty buffers output from the moment
 *    startSession is called, and drains the buffer synchronously into the
 *    xterm terminal on attach — no data is ever lost between tab switches.
 *  - Standalone terminals (task panel, etc.): direct `events.on(ptyDataChannel)`
 *    subscription, same as before.
 *
 * When inside a PaneSizingProvider the terminal is pre-resized to the pane's
 * current dimensions BEFORE being appended to the visible DOM, eliminating
 * the flash caused by a post-mount resize.
 */
export function usePty(
  options: UsePtyOptions,
  containerRef: React.RefObject<HTMLElement | null>
): UseTerminalReturn {
  const { sessionId, theme, mapShiftEnterToCtrlJ, onActivity, onExit, onFirstMessage } = options;

  const pool = useTerminalPool();

  // Stable refs for callbacks so the effect doesn't re-run on every render.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onFirstMessageRef = useRef(onFirstMessage);
  onFirstMessageRef.current = onFirstMessage;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // When inside a PaneSizingProvider, PTY resizes are broadcast to ALL sessions
  // in the pane (including background ones).  Falls back to per-session resize
  // for standalone terminals (chat, task terminal panel, etc.).
  const paneSizing = usePaneSizingContext();
  // Ref so the main effect (which only re-runs on sessionId change) always
  // accesses the latest context value without needing it as a dependency.
  const paneSizingRef = useRef(paneSizing);
  paneSizingRef.current = paneSizing;

  // Subscribe to panel drag state so ResizeObserver skips fits while dragging.
  const isPanelDragging = useSyncExternalStore(
    panelDragStore.subscribe,
    panelDragStore.getSnapshot
  );
  // Keep a ref in sync so the ResizeObserver callback (inside the main effect)
  // always reads the latest value without re-running the effect.
  const isPanelDraggingRef = useRef(isPanelDragging);
  isPanelDraggingRef.current = isPanelDragging;

  // Core xterm.js reference, kept alive across renders.
  const termRef = useRef<Terminal | null>(null);

  // Resize debounce state.
  const pendingResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  // First-message capture state.
  const firstMessageSentRef = useRef(false);
  const inputBufferRef = useRef('');

  // Track whether the PTY has started (to filter focus reporting escape sequences).
  const ptyStartedRef = useRef(false);

  // Auto-copy on selection
  const autoCopyOnSelectionRef = useRef(false);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const queuePtyResize = useCallback(
    (newCols: number, newRows: number) => {
      const c = Math.max(MIN_TERMINAL_COLS, Math.floor(newCols));
      const r = Math.max(MIN_TERMINAL_ROWS, Math.floor(newRows));
      const last = lastSentResizeRef.current;
      if (last?.cols === c && last?.rows === r) return;
      if (pendingResizeTimerRef.current) clearTimeout(pendingResizeTimerRef.current);
      pendingResizeTimerRef.current = setTimeout(() => {
        pendingResizeTimerRef.current = null;
        lastSentResizeRef.current = { cols: c, rows: r };
        rpc.pty.resize(sessionId, c, r);
      }, PTY_RESIZE_DEBOUNCE_MS);
    },
    [sessionId]
  );

  // Stable ref so measureAndResize can always call the latest queuePtyResize
  // without needing it as a useCallback dependency.
  const queuePtyResizeRef = useRef(queuePtyResize);
  queuePtyResizeRef.current = queuePtyResize;

  // measureAndResize is the single entry point for all DOM measurement + PTY
  // resize work.  Mirrors xterm's FitAddon.proposeDimensions() by measuring
  // terminal.element.parentElement (the pool's ownedContainer) — the exact
  // space the terminal occupies — rather than a distant ancestor div.
  // Reports to PaneSizingContext (which broadcasts to ALL sessions in the pane)
  // or directly via queuePtyResize for standalone terminals.
  const measureAndResize = useCallback(
    (retries = 0) => {
      if (!termRef.current) return;
      requestAnimationFrame(() => {
        try {
          const term = termRef.current;
          if (!term) return;
          const pane = paneSizingRef.current;

          const cell = getCellMetrics(term);
          if (!cell) {
            // Cold-path: terminal was opened off-DOM so xterm's font measurement
            // hasn't populated yet.  Retry up to 5 times to avoid an infinite loop.
            if (retries < 5) {
              setTimeout(() => measureAndResizeRef.current(retries + 1), 100);
            }
            return;
          }

          // Measure the terminal's immediate parent (the pool's ownedContainer),
          // matching FitAddon.proposeDimensions().  Fall back to the mount-target
          // container for standalone terminals not using the pool.
          const termParent = (term as unknown as { element?: HTMLElement }).element?.parentElement;
          const measureTarget = termParent ?? (containerRef.current as HTMLElement | null);
          if (!measureTarget) return;

          const dims = measureDimensions(measureTarget, cell.width, cell.height);
          if (!dims) return;
          const { cols: targetCols, rows: targetRows } = dims;

          if (term.cols !== targetCols || term.rows !== targetRows) {
            term.resize(targetCols, targetRows);
          }

          if (pane) {
            pane.reportDimensions(targetCols, targetRows);
          } else {
            queuePtyResizeRef.current(targetCols, targetRows);
          }
        } catch (e) {
          log.warn('useTerminal: measureAndResize failed', { sessionId, error: e });
        }
      });
    },
    [sessionId, containerRef]
  );

  // Stable ref so the retry setTimeout inside measureAndResize always calls
  // the latest version without creating a circular useCallback dependency.
  const measureAndResizeRef = useRef(measureAndResize);
  measureAndResizeRef.current = measureAndResize;

  const applyTheme = useCallback((t?: SessionTheme) => {
    if (!termRef.current) return;
    termRef.current.options.theme = buildTheme(t);
  }, []);

  const setTheme = useCallback(
    (t: SessionTheme) => {
      applyTheme(t);
    },
    [applyTheme]
  );

  const focus = useCallback(() => {
    if (document.activeElement?.closest('[role="dialog"]')) return;
    termRef.current?.focus();
  }, []);

  const copySelectionToClipboard = useCallback(() => {
    const selection = termRef.current?.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).catch(() => {});
    }
  }, []);

  const pasteFromClipboard = useCallback(() => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) rpc.pty.sendInput(sessionId, text);
      })
      .catch(() => {});
  }, [sessionId]);

  // ─── Main effect: lease terminal once per sessionId ────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Compute targetDims for flash-free mounting ────────────────────────────
    // Preferred: direct DOM measurement of the pane container + prior
    // terminal's cell metrics (available on all tab switches after first mount).
    // Falls back to cached cols/rows when cell metrics are unavailable (very
    // first mount in a fresh session).
    const pane = paneSizingRef.current;
    const prevCell = termRef.current ? getCellMetrics(termRef.current) : null;
    let targetDims: { cols: number; rows: number } | undefined;

    if (pane?.containerRef.current && prevCell) {
      const measured = measureDimensions(
        pane.containerRef.current,
        prevCell.width,
        prevCell.height
      );
      if (measured) targetDims = measured;
    }

    if (!targetDims && pane) {
      targetDims = pane.getCurrentDimensions() ?? undefined;
    }

    // ── Lease terminal from pool (creates or reparents) ───────────────────────
    // targetDims causes the pool to pre-resize the terminal BEFORE appendChild,
    // so the canvas is never visible at the wrong size.
    const { terminal } = pool.lease(sessionId, container as HTMLElement, {
      theme: themeRef.current,
      targetDims,
    });
    termRef.current = terminal;

    // ── Attach FrontendPty (drains buffer before first WebGL paint) ───────────
    // For conversation sessions the FrontendPty has been accumulating output
    // since startSession was called, even while this tab was inactive.
    // attach() drains that buffer synchronously — the pool's rAF repaint hasn't
    // fired yet, so the buffered content is in xterm before the first frame.
    const frontendPty = frontendPtyRegistry.get(sessionId);
    if (frontendPty) {
      frontendPty.attach(terminal, () => {
        ptyStartedRef.current = true;
      });
    }

    // Always sync after mounting — targetDims may be stale if the pane was
    // resized while this session was off-screen.  measureAndResize defers to
    // rAF so it reads the live DOM and only calls term.resize() when needed.
    measureAndResize();

    // ── Load settings ────────────────────────────────────────────────────────
    let customFontFamily = '';
    void (rpc.appSettings.get('terminal') as Promise<AppSettings['terminal']>).then(
      (terminalSettings) => {
        if (terminalSettings?.fontFamily) {
          customFontFamily = terminalSettings.fontFamily.trim();
          if (customFontFamily) terminal.options.fontFamily = customFontFamily;
        }
        autoCopyOnSelectionRef.current = terminalSettings?.autoCopyOnSelection ?? false;
      }
    );

    // ── DECRQM xterm.js 6.0 bug workaround ──────────────────────────────────
    const cleanups: (() => void)[] = [];

    try {
      const parser = (
        terminal as unknown as {
          parser?: { registerCsiHandler?: (...args: unknown[]) => { dispose(): void } };
        }
      ).parser;
      if (parser?.registerCsiHandler) {
        const ansiDisp = parser.registerCsiHandler(
          { intermediates: '$', final: 'p' },
          (params: (number | number[])[]) => {
            const mode = (params[0] as number) ?? 0;
            rpc.pty.sendInput(sessionId, `\x1b[${mode};0$y`);
            return true;
          }
        );
        const decDisp = parser.registerCsiHandler(
          { prefix: '?', intermediates: '$', final: 'p' },
          (params: (number | number[])[]) => {
            const mode = (params[0] as number) ?? 0;
            rpc.pty.sendInput(sessionId, `\x1b[?${mode};0$y`);
            return true;
          }
        );
        cleanups.push(
          () => ansiDisp.dispose(),
          () => decDisp.dispose()
        );
      }
    } catch (err) {
      log.warn('useTerminal: failed to register DECRQM workaround', { error: err });
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return false;

      if (shouldCopySelectionFromTerminal(event, IS_MAC_PLATFORM, terminal.hasSelection())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        copySelectionToClipboard();
        return false;
      }

      if (shouldPasteToTerminal(event, IS_MAC_PLATFORM)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        pasteFromClipboard();
        return false;
      }

      if (mapShiftEnterToCtrlJ && shouldMapShiftEnterToCtrlJ(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        rpc.pty.sendInput(sessionId, CTRL_J_ASCII);
        return false;
      }

      if (shouldKillLineFromTerminal(event, IS_MAC_PLATFORM)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        rpc.pty.sendInput(sessionId, CTRL_U_ASCII);
        return false;
      }

      if (IS_MAC_PLATFORM && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          rpc.pty.sendInput(sessionId, '\x01');
          return false;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          rpc.pty.sendInput(sessionId, '\x05');
          return false;
        }
      }

      return true;
    });

    // ── Handle terminal input ─────────────────────────────────────────────────
    const handleTerminalInput = (data: string, isNewlineInsert = false) => {
      onActivityRef.current?.();

      let filtered = data;
      if (!ptyStartedRef.current) {
        filtered = data.replace(/\x1b\[I|\x1b\[O/g, '');
      }
      if (!filtered) return;

      // First-message capture
      if (!firstMessageSentRef.current && onFirstMessageRef.current) {
        inputBufferRef.current += filtered;
        const newlineIndex = inputBufferRef.current.indexOf('\r');
        if (newlineIndex !== -1) {
          const message = inputBufferRef.current.slice(0, newlineIndex);
          onFirstMessageRef.current(message);
          firstMessageSentRef.current = true;
        }
      }

      const isEnterPress = filtered.includes('\r') || filtered.includes('\n');
      const pendingText = pendingInjectionManager.getPending();
      if (pendingText && isEnterPress && !isNewlineInsert) {
        const stripped = filtered.replace(/[\r\n]+$/g, '');
        const enterSequence = filtered.includes('\r') ? '\r' : '\n';
        const injectedData = stripped + pendingText + enterSequence + enterSequence;
        rpc.pty.sendInput(sessionId, injectedData);
        pendingInjectionManager.markUsed();
        return;
      }

      rpc.pty.sendInput(sessionId, filtered);
    };

    const inputDisposable = terminal.onData((data) => handleTerminalInput(data));
    cleanups.push(() => inputDisposable.dispose());

    // ── Auto-copy on selection ────────────────────────────────────────────────
    let selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (!autoCopyOnSelectionRef.current) return;
      if (!terminal.hasSelection()) return;
      if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
      selectionDebounceTimer = setTimeout(() => {
        if (terminal.hasSelection()) copySelectionToClipboard();
      }, 150);
    });
    cleanups.push(() => {
      selectionDisposable.dispose();
      if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
    });

    // ── Paste from app menu ───────────────────────────────────────────────────
    const offPaste = events.on(appPasteChannel, () => {
      pasteFromClipboard();
    });
    cleanups.push(offPaste);

    // ── PTY data subscription ─────────────────────────────────────────────────
    // Conversation sessions use FrontendPty (attached above) — it handles data
    // routing, buffering, and the ptyStartedRef callback.
    // Standalone terminals (task terminal panel etc.) fall back to a direct
    // events.on subscription since they are not in the FrontendPtyRegistry.
    if (!frontendPty) {
      const offData = events.on(
        ptyDataChannel,
        (data) => {
          if (typeof data !== 'string') return;
          ptyStartedRef.current = true;
          try {
            terminal.write(data);
          } catch (e) {
            log.warn('useTerminal: terminal.write failed', { sessionId, error: e });
          }
        },
        sessionId
      );
      cleanups.push(offData);
    }

    // ── PTY exit subscription ─────────────────────────────────────────────────
    const offExit = events.on(
      ptyExitChannel,
      (info) => {
        onExitRef.current?.(info as { exitCode: number | undefined; signal?: number });
      },
      sessionId
    );
    cleanups.push(offExit);

    // ── Font / setting change events ──────────────────────────────────────────
    const handleFontChange = (e: Event) => {
      const detail = (e as CustomEvent<{ fontFamily?: string }>).detail;
      customFontFamily = detail?.fontFamily?.trim() ?? '';
      terminal.options.fontFamily = customFontFamily || undefined;
      measureAndResize();
    };
    const handleAutoCopyChange = (e: Event) => {
      const detail = (e as CustomEvent<{ autoCopyOnSelection?: boolean }>).detail;
      autoCopyOnSelectionRef.current = detail?.autoCopyOnSelection ?? false;
    };
    window.addEventListener('terminal-font-changed', handleFontChange);
    window.addEventListener('terminal-auto-copy-changed', handleAutoCopyChange);
    cleanups.push(
      () => window.removeEventListener('terminal-font-changed', handleFontChange),
      () => window.removeEventListener('terminal-auto-copy-changed', handleAutoCopyChange)
    );

    // ── ResizeObserver (observes the mount-target, not the pool-owned div) ────
    // Skips measuring while a panel drag is in progress; the drag-end effect
    // below fires one measure once the drag completes.
    const resizeObserver = new ResizeObserver(() => {
      if (!isPanelDraggingRef.current) measureAndResize();
    });
    resizeObserver.observe(container);
    cleanups.push(() => resizeObserver.disconnect());

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      if (pendingResizeTimerRef.current) {
        clearTimeout(pendingResizeTimerRef.current);
        pendingResizeTimerRef.current = null;
      }
      // Reset dedup so the next session always gets a resize on mount
      // (guards the fallback path used by standalone terminals).
      lastSentResizeRef.current = null;
      for (const fn of cleanups) {
        try {
          fn();
        } catch {}
      }
      // Detach FrontendPty so future PTY output resumes buffering while the
      // terminal is parked off-screen.  Must happen before pool.release() so
      // data never goes to a reparented (off-screen) terminal.
      frontendPty?.detach();
      // Return terminal to the pool's off-screen host (keeps it alive).
      pool.release(sessionId);
      termRef.current = null;
      ptyStartedRef.current = false;
      firstMessageSentRef.current = false;
      inputBufferRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // Re-run only when the session changes

  // ── Theme update (after initial mount) ──────────────────────────────────────
  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  // ── Measure once when a panel drag ends ─────────────────────────────────────
  // The ResizeObserver skips measurements during the drag; this effect fires a
  // single measurement (which resizes the terminal and notifies PTYs) when done.
  const prevIsPanelDraggingRef = useRef(isPanelDragging);
  useEffect(() => {
    const wasDragging = prevIsPanelDraggingRef.current;
    prevIsPanelDraggingRef.current = isPanelDragging;
    if (wasDragging && !isPanelDragging) {
      measureAndResize();
    }
  }, [isPanelDragging, measureAndResize]);

  return { focus, setTheme };
}

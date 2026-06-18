import { type Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { dispatchMatchingHotkeys } from '@renderer/lib/hotkeys/dispatch-matching-hotkeys';
import { events, rpc } from '@renderer/lib/ipc';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { log } from '@renderer/utils/logger';
import type { AppSettings } from '@shared/core/app-settings';
import { ptyDataChannel, ptyExitChannel } from '@shared/core/pty/ptyEvents';
import { TERMINAL_FONT_SIZE_DEFAULT } from '@shared/core/terminals/terminal-settings';
import { appPasteChannel } from '@shared/events/appEvents';
import { getDomTabNavigationDirection } from '@shared/shortcuts';
import { usePaneSizingContext } from './pane-sizing-context';
import type { FrontendPty, SessionTheme } from './pty';
import { measureDimensions } from './pty-dimensions';
import { isRealTaskInput, SubmittedInputBuffer } from './pty-input-buffer';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  shouldCopySelectionFromTerminal,
  shouldHandleInterruptFromTerminal,
  shouldKillLineFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
} from './pty-keybindings';
import { buildTerminalFontFamily } from './terminal-font';

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

const PTY_RESIZE_DEBOUNCE_MS = 120;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;
const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const IS_WINDOWS_PLATFORM = typeof navigator !== 'undefined' && /Win/.test(navigator.platform);
const LAST_SELECTION_COPY_GRACE_MS = 2_000;

function dispatchTerminalTabNavigationHotkey(event: KeyboardEvent): boolean {
  if (!getDomTabNavigationDirection(event)) return false;
  return dispatchMatchingHotkeys(event, { dispatch: 'first' });
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

function getRecentSelection(selection: { text: string; capturedAt: number } | null): string {
  if (!selection) return '';
  if (Date.now() - selection.capturedAt > LAST_SELECTION_COPY_GRACE_MS) return '';
  return selection.text;
}

export interface UsePtyOptions {
  /** Deterministic PTY session ID: makePtySessionId(projectId, scopeId, leafId). */
  sessionId: string;
  /** Pre-connected FrontendPty instance owned by the entity's PtySession store. */
  pty: FrontendPty;
  theme?: SessionTheme;
  mapShiftEnterToCtrlJ?: boolean;
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onInterruptPress?: () => void;
  onPasteFromClipboard?: PasteFromClipboardHandler;
}

export interface UseTerminalReturn {
  focus: () => void;
  setTheme: (theme: SessionTheme) => void;
  sendInput: (data: string, options?: { track?: boolean }) => void;
}

export type PasteFromClipboardHandler = (helpers: {
  focus: UseTerminalReturn['focus'];
  sendInput: UseTerminalReturn['sendInput'];
}) => void;

/**
 * React hook that manages a full xterm.js terminal instance attached to
 * `containerRef`, wired to a PTY session via the deterministic `sessionId`.
 *
 * Each session owns a persistent FrontendPty (terminal + Canvas2D renderer)
 * for its full lifetime.  On unmount the terminal's ownedContainer is
 * reparented to the off-screen xterm host rather than disposed, so scrollback
 * is preserved across tab switches.
 *
 * For sessions pre-registered via PtySessionProvider the mount is effectively
 * synchronous (no await needed).  Standalone sessions (not pre-registered)
 * are auto-registered inside an async IIFE, awaiting the historical buffer
 * fetch before mounting.
 *
 * When inside a PaneSizingProvider the terminal is pre-resized to the pane's
 * current dimensions BEFORE being appended to the visible DOM, eliminating
 * the flash caused by a post-mount resize.
 */
export function usePty(
  options: UsePtyOptions,
  containerRef: React.RefObject<HTMLElement | null>
): UseTerminalReturn {
  const {
    sessionId,
    pty,
    theme,
    mapShiftEnterToCtrlJ,
    onActivity,
    onExit,
    onFirstMessage,
    onEnterPress,
    onInterruptPress,
    onPasteFromClipboard,
  } = options;

  // Stable refs for callbacks so the effect doesn't re-run on every render.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onFirstMessageRef = useRef(onFirstMessage);
  onFirstMessageRef.current = onFirstMessage;
  const onEnterPressRef = useRef(onEnterPress);
  onEnterPressRef.current = onEnterPress;
  const onInterruptPressRef = useRef(onInterruptPress);
  onInterruptPressRef.current = onInterruptPress;
  const onPasteFromClipboardRef = useRef(onPasteFromClipboard);
  onPasteFromClipboardRef.current = onPasteFromClipboard;
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

  // Tracks submitted user input while filtering terminal control traffic.
  const submittedInputBufferRef = useRef(new SubmittedInputBuffer());

  // Track whether the PTY has started (to filter focus reporting escape sequences).
  const ptyStartedRef = useRef(false);

  // Auto-copy on selection
  const autoCopyOnSelectionRef = useRef(false);
  const lastSelectionRef = useRef<{ text: string; capturedAt: number } | null>(null);

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
        void rpc.pty.resize(sessionId, c, r);
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
  // terminal.element.parentElement (the FrontendPty's ownedContainer) — the
  // exact space the terminal occupies — rather than a distant ancestor div.
  // Reports to PaneSizingContext (which broadcasts to ALL sessions in the pane)
  // or directly via queuePtyResize for standalone terminals.
  //
  // Runs synchronously (no rAF wrapper).  ResizeObserver fires after layout
  // and before paint, so a sync term.resize() in that callback lets the xterm
  // DOM catch up in the same paint as the new container size — eliminating
  // the one-frame mismatch that produces the visible flicker on
  // cmd+J / cmd+B toggles.  Other call sites (mount, font change, drag-end)
  // also benefit from running before the next paint instead of one frame later.
  const measureAndResize = useCallback(
    (retries = 0) => {
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

        // Measure the terminal's immediate parent (the FrontendPty's ownedContainer),
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
    },
    [sessionId, containerRef]
  );

  // Stable ref so the retry setTimeout inside measureAndResize always calls
  // the latest version without creating a circular useCallback dependency.
  const measureAndResizeRef = useRef(measureAndResize);
  measureAndResizeRef.current = measureAndResize;

  const applyTheme = useCallback(
    (t?: SessionTheme) => {
      pty.setTheme(t);
    },
    [pty]
  );

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
    const selection =
      termRef.current?.getSelection() || getRecentSelection(lastSelectionRef.current);
    if (selection) {
      navigator.clipboard.writeText(selection).catch(() => {});
    }
  }, []);

  const sendInput = useCallback(
    (data: string, options?: { track?: boolean }) => {
      const shouldTrack = options?.track ?? true;
      if (shouldTrack) {
        const submittedMessages = submittedInputBufferRef.current.feed(data);
        for (const message of submittedMessages) {
          if (isRealTaskInput(message)) {
            onEnterPressRef.current?.(message);
          }
        }
      }
      void rpc.pty.sendInput(sessionId, data);
    },
    [sessionId]
  );

  const pasteFromClipboard = useCallback(() => {
    const customPasteFromClipboard = onPasteFromClipboardRef.current;
    if (customPasteFromClipboard) {
      customPasteFromClipboard({ focus, sendInput });
      return;
    }

    void (async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) sendInput(text);
      } catch {
        // Clipboard read denied or unavailable.
      }
    })();
  }, [focus, sendInput]);

  // ─── Main effect: mount terminal once per sessionId ────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Compute targetDims synchronously ─────────────────────────────────────
    // Reads the previous session's terminal cell metrics before overwriting
    // termRef. PaneSizingContext dimensions are also sampled here so the
    // pre-resize happens against the live pane dimensions.
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

    // ── Mount ─────────────────────────────────────────────────────────────────
    // pty is pre-connected by PtySession before TerminalPane renders, so no
    // async work is needed here.
    const cleanups: (() => void)[] = [];

    {
      const frontendPty = pty;
      termRef.current = frontendPty.terminal;
      lastSelectionRef.current = null;

      // Apply current theme before mounting (in case it differs from the
      // theme the terminal was constructed with).
      frontendPty.setTheme(themeRef.current);

      // Mount: pre-resize then appendChild (flash-free).
      frontendPty.mount(container as HTMLElement, targetDims);

      // Always sync after mounting — targetDims may be stale if the pane was
      // resized while this session was off-screen.  measureAndResize defers to
      // rAF so it reads the live DOM and only calls term.resize() when needed.
      measureAndResize();

      // ── Load settings ──────────────────────────────────────────────────────
      let customFontFamily = '';
      void (rpc.appSettings.get('terminal') as Promise<AppSettings['terminal']>).then(
        (terminalSettings) => {
          if (terminalSettings?.fontFamily) {
            customFontFamily = terminalSettings.fontFamily.trim();
            if (customFontFamily) {
              frontendPty.terminal.options.fontFamily = buildTerminalFontFamily(customFontFamily);
            }
          }
          frontendPty.terminal.options.fontSize =
            terminalSettings?.fontSize ?? TERMINAL_FONT_SIZE_DEFAULT;
          measureAndResize();
          autoCopyOnSelectionRef.current = terminalSettings?.autoCopyOnSelection ?? false;
          frontendPty.terminal.options.macOptionIsMeta = terminalSettings?.macOptionIsMeta ?? false;
        }
      );

      // ── DECRQM xterm.js 6.0 bug workaround ────────────────────────────────
      const terminal = frontendPty.terminal;
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
              sendInput(`\x1b[${mode};0$y`, { track: false });
              return true;
            }
          );
          const decDisp = parser.registerCsiHandler(
            { prefix: '?', intermediates: '$', final: 'p' },
            (params: (number | number[])[]) => {
              const mode = (params[0] as number) ?? 0;
              sendInput(`\x1b[?${mode};0$y`, { track: false });
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

      // ── Keyboard shortcuts ─────────────────────────────────────────────────
      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (document.querySelector('[role="dialog"]')) return false;

        if (dispatchTerminalTabNavigationHotkey(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          return false;
        }

        if (
          shouldCopySelectionFromTerminal(
            event,
            IS_MAC_PLATFORM,
            terminal.hasSelection(),
            getRecentSelection(lastSelectionRef.current) !== ''
          )
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          copySelectionToClipboard();
          return false;
        }

        if (shouldPasteToTerminal(event, IS_MAC_PLATFORM, IS_WINDOWS_PLATFORM)) {
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
          sendInput(CTRL_J_ASCII);
          return false;
        }

        if (shouldKillLineFromTerminal(event, IS_MAC_PLATFORM)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          sendInput(CTRL_U_ASCII);
          return false;
        }

        if (shouldHandleInterruptFromTerminal(event)) {
          onInterruptPressRef.current?.();
          return true;
        }

        if (
          IS_MAC_PLATFORM &&
          event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            sendInput('\x01');
            return false;
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            sendInput('\x05');
            return false;
          }
        }

        return true;
      });

      // ── Handle terminal input ──────────────────────────────────────────────
      const handleTerminalInput = (data: string) => {
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

        sendInput(filtered);
      };

      const inputDisposable = terminal.onData((data) => handleTerminalInput(data));
      cleanups.push(() => inputDisposable.dispose());

      // ── ptyStartedRef — detect first PTY output ────────────────────────────
      // FrontendPty owns the data subscription and writes directly to the
      // terminal.  We add a lightweight IPC listener here solely to flip the
      // ptyStartedRef flag, which is used to suppress focus-reporting escape
      // sequences before the PTY shell has initialised.
      const offPtyData = events.on(
        ptyDataChannel,
        () => {
          ptyStartedRef.current = true;
        },
        sessionId
      );
      cleanups.push(offPtyData);

      // ── Auto-copy on selection ─────────────────────────────────────────────
      let selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      const selectionDisposable = terminal.onSelectionChange(() => {
        const selection = terminal.getSelection();
        if (selection) {
          lastSelectionRef.current = { text: selection, capturedAt: Date.now() };
        }

        if (!autoCopyOnSelectionRef.current) return;
        if (!terminal.hasSelection()) return;
        if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
        selectionDebounceTimer = setTimeout(() => {
          if (terminal.hasSelection()) {
            copySelectionToClipboard();
          }
        }, 150);
      });
      cleanups.push(() => {
        selectionDisposable.dispose();
        if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
      });

      // ── Paste from app menu ────────────────────────────────────────────────
      const offPaste = events.on(appPasteChannel, () => {
        pasteFromClipboard();
      });
      cleanups.push(offPaste);

      // ── PTY exit subscription ──────────────────────────────────────────────
      const offExit = events.on(
        ptyExitChannel,
        (info) => {
          onExitRef.current?.(info as { exitCode: number | undefined; signal?: number });
        },
        sessionId
      );
      cleanups.push(offExit);

      // ── Font / setting change events ───────────────────────────────────────
      const handleFontChange = (e: Event) => {
        const detail = (e as CustomEvent<{ fontFamily?: string; fontSize?: number }>).detail;
        if (detail?.fontFamily !== undefined) {
          customFontFamily = detail.fontFamily.trim();
          terminal.options.fontFamily = buildTerminalFontFamily(customFontFamily);
        }
        if (detail?.fontSize !== undefined) {
          terminal.options.fontSize = detail.fontSize;
        }
        measureAndResize();
      };
      const handleAutoCopyChange = (e: Event) => {
        const detail = (e as CustomEvent<{ autoCopyOnSelection?: boolean }>).detail;
        autoCopyOnSelectionRef.current = detail?.autoCopyOnSelection ?? false;
      };
      const handleMacOptionIsMetaChange = (e: Event) => {
        const detail = (e as CustomEvent<{ macOptionIsMeta?: boolean }>).detail;
        terminal.options.macOptionIsMeta = detail?.macOptionIsMeta ?? false;
      };
      window.addEventListener('terminal-font-changed', handleFontChange);
      window.addEventListener('terminal-auto-copy-changed', handleAutoCopyChange);
      window.addEventListener('terminal-mac-option-is-meta-changed', handleMacOptionIsMetaChange);
      cleanups.push(
        () => window.removeEventListener('terminal-font-changed', handleFontChange),
        () => window.removeEventListener('terminal-auto-copy-changed', handleAutoCopyChange),
        () =>
          window.removeEventListener(
            'terminal-mac-option-is-meta-changed',
            handleMacOptionIsMetaChange
          )
      );

      // ── ResizeObserver (observes the mount-target, not the owned container) ─
      // Skips measuring while a panel drag is in progress; the drag-end effect
      // below fires one measure once the drag completes.
      //
      // Single-shot layout changes (cmd+J drawer toggle, cmd+B sidebar toggle,
      // navigation) need an *immediate* term.resize so the xterm DOM catches
      // up in the same paint as the container — otherwise the user sees a
      // frame where the container is at the new size but the terminal grid
      // is still at the old size (the flicker).  Bursty changes (continuous
      // window-corner resize) still need coalescing so we don't spam
      // term.resize() every frame.
      //
      // Strategy: leading-edge fire after a quiet period; trailing-edge fire
      // for the tail of a burst.
      const RESIZE_QUIET_MS = 150;
      const RESIZE_TRAILING_MS = 50;
      let lastResizeAt = 0;
      let trailingTimer: ReturnType<typeof setTimeout> | null = null;
      const fireResize = () => {
        lastResizeAt = performance.now();
        measureAndResizeRef.current();
      };
      const resizeObserver = new ResizeObserver(() => {
        if (isPanelDraggingRef.current) return;
        if (performance.now() - lastResizeAt > RESIZE_QUIET_MS) {
          fireResize();
          return;
        }
        if (trailingTimer) clearTimeout(trailingTimer);
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          fireResize();
        }, RESIZE_TRAILING_MS);
      });
      resizeObserver.observe(container);
      cleanups.push(() => {
        resizeObserver.disconnect();
        if (trailingTimer) {
          clearTimeout(trailingTimer);
          trailingTimer = null;
        }
      });
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      if (pendingResizeTimerRef.current) {
        clearTimeout(pendingResizeTimerRef.current);
        pendingResizeTimerRef.current = null;
      }
      // Reset dedup so the next session always gets a resize on mount.
      lastSentResizeRef.current = null;
      // ResizeObserver.disconnect() and other cleanups run BEFORE unmount —
      // preserving the invariant that the ResizeObserver is torn down before
      // the ownedContainer is reparented off-screen.
      for (const fn of cleanups) {
        try {
          fn();
        } catch {}
      }
      // Return terminal's ownedContainer to the off-screen host.
      pty.unmount();
      termRef.current = null;
      ptyStartedRef.current = false;
      firstMessageSentRef.current = false;
      inputBufferRef.current = '';
      submittedInputBufferRef.current = new SubmittedInputBuffer();
    };
    // oxlint-disable-next-line react/exhaustive-deps
  }, [sessionId, pty]); // Re-run only when the session changes

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

  return { focus, setTheme, sendInput };
}

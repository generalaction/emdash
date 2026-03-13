import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { useCallback, useEffect, useRef } from 'react';
import type { AppSettings } from '@shared/app-settings';
import { appPasteChannel } from '@shared/events/appEvents';
import { ptyDataChannel, ptyExitChannel } from '@shared/events/ptyEvents';
import { cssVar } from '../lib/cssVars';
import { events, rpc } from '../lib/ipc';
import { log } from '../lib/logger';
import { pendingInjectionManager } from '../lib/PendingInjectionManager';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  shouldCopySelectionFromTerminal,
  shouldKillLineFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
} from '../terminal/terminalKeybindings';

const SCROLLBACK_LINES = 100_000;
const PTY_RESIZE_DEBOUNCE_MS = 60;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;
const PANEL_RESIZE_DRAGGING_EVENT = 'emdash:panel-resize-dragging';
const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export interface SessionTheme {
  override?: ITerminalOptions['theme'];
}

export interface UseTerminalOptions {
  /** Deterministic PTY session ID: makePtySessionId(projectId, taskId, conversationId|terminalId) */
  sessionId: string;
  theme?: SessionTheme;
  cols?: number;
  rows?: number;
  mapShiftEnterToCtrlJ?: boolean;
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
  onLinkClick?: (url: string) => void;
}

export interface UseTerminalReturn {
  focus: () => void;
  setTheme: (theme: SessionTheme) => void;
}

function readXtermCssVars(): ITerminalOptions['theme'] {
  return {
    background: cssVar('--xterm-bg'),
    foreground: cssVar('--xterm-fg'),
    cursor: cssVar('--xterm-cursor'),
    cursorAccent: cssVar('--xterm-cursor-accent'),
    selectionBackground: cssVar('--xterm-selection-bg'),
    selectionForeground: cssVar('--xterm-selection-fg'),
  };
}

function buildTheme(theme?: SessionTheme): ITerminalOptions['theme'] {
  if (theme?.override) return { ...readXtermCssVars(), ...theme.override };
  return readXtermCssVars();
}

/**
 * React hook that manages a full xterm.js terminal instance attached to
 * `containerRef`, wired to a PTY session via the deterministic `sessionId`.
 *
 * The hook subscribes to `ptyDataChannel.{sessionId}` for output and sends
 * input/resize via `rpc.pty.sendInput` / `rpc.pty.resize`.
 *
 * IMPORTANT: subscribe to ptyDataChannel (using makePtySessionId) BEFORE
 * calling the RPC that starts the session so the renderer never misses the
 * first data chunk.
 */
export function useTerminal(
  options: UseTerminalOptions,
  containerRef: React.RefObject<HTMLElement | null>
): UseTerminalReturn {
  const {
    sessionId,
    theme,
    cols = 120,
    rows = 32,
    mapShiftEnterToCtrlJ,
    onActivity,
    onExit,
    onFirstMessage,
    onLinkClick,
  } = options;

  // Stable refs for callbacks so the effect doesn't re-run on every render.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onFirstMessageRef = useRef(onFirstMessage);
  onFirstMessageRef.current = onFirstMessage;
  const onLinkClickRef = useRef(onLinkClick);
  onLinkClickRef.current = onLinkClick;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Core xterm.js references, kept alive across renders.
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);

  // Resize debounce state.
  const pendingResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const isPanelResizeDraggingRef = useRef(false);

  // First-message capture state.
  const firstMessageSentRef = useRef(false);
  const inputBufferRef = useRef('');

  // Track whether the PTY has started (to filter focus reporting escape sequences).
  const ptyStartedRef = useRef(false);

  // Auto-copy on selection
  const autoCopyOnSelectionRef = useRef(false);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const scheduleFit = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current) return;
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch (e) {
        log.warn('useTerminal: fit failed', { sessionId, error: e });
      }
    });
  }, [sessionId]);

  const clearQueuedResize = useCallback(() => {
    if (pendingResizeTimerRef.current) {
      clearTimeout(pendingResizeTimerRef.current);
      pendingResizeTimerRef.current = null;
    }
    pendingResizeRef.current = null;
  }, []);

  const flushQueuedResize = useCallback(() => {
    const pending = pendingResizeRef.current;
    pendingResizeRef.current = null;
    if (!pending) return;
    const last = lastSentResizeRef.current;
    if (last && last.cols === pending.cols && last.rows === pending.rows) return;
    lastSentResizeRef.current = pending;
    void rpc.pty.resize(sessionId, pending.cols, pending.rows);
  }, [sessionId]);

  const queuePtyResize = useCallback(
    (newCols: number, newRows: number) => {
      const c = Math.max(MIN_TERMINAL_COLS, Math.floor(newCols));
      const r = Math.max(MIN_TERMINAL_ROWS, Math.floor(newRows));
      pendingResizeRef.current = { cols: c, rows: r };

      if (isPanelResizeDraggingRef.current) return;

      if (pendingResizeTimerRef.current) clearTimeout(pendingResizeTimerRef.current);
      pendingResizeTimerRef.current = setTimeout(() => {
        pendingResizeTimerRef.current = null;
        flushQueuedResize();
      }, PTY_RESIZE_DEBOUNCE_MS);
    },
    [flushQueuedResize]
  );

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
        if (text) void rpc.pty.sendInput(sessionId, text);
      })
      .catch(() => {});
  }, [sessionId]);

  // ─── Main effect: create terminal once per sessionId ───────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Build xterm.js instance ──────────────────────────────────────────────
    const openLink = (uri: string) => {
      if (onLinkClickRef.current) {
        onLinkClickRef.current(uri);
      } else {
        void rpc.app.openExternal(uri).catch((error) => {
          log.warn('useTerminal: failed to open external link', { uri, error });
        });
      }
    };

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
      linkHandler: { activate: (_event, text) => openLink(text) },
      theme: buildTheme(themeRef.current),
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      openLink(uri);
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(webLinksAddon);

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss?.(() => {
        try {
          webglAddon?.dispose();
        } catch {}
        webglAddon = null;
        webglAddonRef.current = null;
      });
      terminal.loadAddon(webglAddon);
    } catch {
      webglAddon = null;
    }

    termRef.current = terminal;
    fitAddonRef.current = fitAddon;
    webglAddonRef.current = webglAddon;

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
      const parser = (terminal as any).parser;
      if (parser?.registerCsiHandler) {
        const ansiDisp = parser.registerCsiHandler(
          { intermediates: '$', final: 'p' },
          (params: (number | number[])[]) => {
            const mode = (params[0] as number) ?? 0;
            void rpc.pty.sendInput(sessionId, `\x1b[${mode};0$y`);
            return true;
          }
        );
        const decDisp = parser.registerCsiHandler(
          { prefix: '?', intermediates: '$', final: 'p' },
          (params: (number | number[])[]) => {
            const mode = (params[0] as number) ?? 0;
            void rpc.pty.sendInput(sessionId, `\x1b[?${mode};0$y`);
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
        void rpc.pty.sendInput(sessionId, CTRL_J_ASCII);
        return false;
      }

      if (shouldKillLineFromTerminal(event, IS_MAC_PLATFORM)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        void rpc.pty.sendInput(sessionId, CTRL_U_ASCII);
        return false;
      }

      if (IS_MAC_PLATFORM && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          void rpc.pty.sendInput(sessionId, '\x01');
          return false;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          void rpc.pty.sendInput(sessionId, '\x05');
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
        void rpc.pty.sendInput(sessionId, injectedData);
        pendingInjectionManager.markUsed();
        return;
      }

      void rpc.pty.sendInput(sessionId, filtered);
    };

    const inputDisposable = terminal.onData((data) => handleTerminalInput(data));
    cleanups.push(() => inputDisposable.dispose());

    // ── PTY resize from terminal dimensions ───────────────────────────────────
    const resizeDisposable = terminal.onResize(({ cols: c, rows: r }) => {
      queuePtyResize(c, r);
    });
    cleanups.push(() => resizeDisposable.dispose());

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
      scheduleFit();
    };
    const handleAutoCopyChange = (e: Event) => {
      const detail = (e as CustomEvent<{ autoCopyOnSelection?: boolean }>).detail;
      autoCopyOnSelectionRef.current = detail?.autoCopyOnSelection ?? false;
    };
    const handlePanelResizeDragging = (e: Event) => {
      const detail = (e as CustomEvent<{ dragging?: boolean }>).detail;
      const dragging = Boolean(detail?.dragging);
      if (isPanelResizeDraggingRef.current === dragging) return;
      isPanelResizeDraggingRef.current = dragging;
      if (pendingResizeTimerRef.current) {
        clearTimeout(pendingResizeTimerRef.current);
        pendingResizeTimerRef.current = null;
      }
      if (!dragging) flushQueuedResize();
    };
    window.addEventListener('terminal-font-changed', handleFontChange);
    window.addEventListener('terminal-auto-copy-changed', handleAutoCopyChange);
    window.addEventListener(
      PANEL_RESIZE_DRAGGING_EVENT,
      handlePanelResizeDragging as EventListener
    );
    cleanups.push(
      () => window.removeEventListener('terminal-font-changed', handleFontChange),
      () => window.removeEventListener('terminal-auto-copy-changed', handleAutoCopyChange),
      () =>
        window.removeEventListener(
          PANEL_RESIZE_DRAGGING_EVENT,
          handlePanelResizeDragging as EventListener
        )
    );

    // ── Open terminal in container ────────────────────────────────────────────
    terminal.open(container);
    const el = (terminal as any).element as HTMLElement | null;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
    }

    // ── ResizeObserver ────────────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(container);
    cleanups.push(() => resizeObserver.disconnect());

    // Initial fit
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {}
    });

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      clearQueuedResize();
      for (const fn of cleanups) {
        try {
          fn();
        } catch {}
      }
      try {
        webglAddon?.dispose();
      } catch {}
      try {
        terminal.dispose();
      } catch {}
      termRef.current = null;
      fitAddonRef.current = null;
      webglAddonRef.current = null;
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

  return { focus, setTheme };
}

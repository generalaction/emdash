import { toast } from '@emdash/ui/react/primitives';
import { type Terminal } from '@xterm/xterm';
import { reaction } from 'mobx';
import { useCallback, useEffect, useRef } from 'react';
import type { FrontendPty, SessionTheme } from '@core/features/terminals/api/browser/pty/pty';
import { TERMINAL_PADDING_PX } from '@core/features/terminals/api/browser/pty/pty';
import { measureDimensions } from '@core/features/terminals/api/browser/pty/pty-dimensions';
import { buildTerminalFontFamily } from '@core/features/terminals/api/browser/pty/terminal-font';
import { getCellMetrics } from '@core/features/terminals/api/browser/pty/xterm-cell-metrics';
import { usePaneSizingContext } from '@core/features/terminals/contributions/browser/pty/pane-sizing-context';
import type { ClipboardSource } from '@core/primitives/desktop-host/api/host-contract';
import {
  copyTextToClipboard,
  getHostClient,
} from '@core/primitives/desktop-host/browser/host-client';
import { log } from '@core/primitives/logging/browser/logger';
import { TERMINAL_FONT_SIZE_DEFAULT } from '@core/primitives/terminals/api';
import type { AppSettings } from '@core/services/settings/api';
import { getAppSettingsClient } from '@core/services/settings/api/client';
import { isRealTaskInput, SubmittedInputBuffer } from './pty-input-buffer';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  getMacOptionArrowSequence,
  shouldCopySelectionFromTerminal,
  shouldHandleInterruptFromTerminal,
  shouldKillLineFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
} from './pty-keybindings';
import { getTerminalContextLink } from './terminal-context-link';
import { TerminalInputQueue } from './terminal-paste';
import { createTerminalReplyClassifier } from './terminal-replies';

const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const IS_WINDOWS_PLATFORM = typeof navigator !== 'undefined' && /Win/.test(navigator.platform);
const IS_LINUX_PLATFORM = typeof navigator !== 'undefined' && /Linux/.test(navigator.platform);
const LAST_SELECTION_COPY_GRACE_MS = 2_000;

function getRecentSelection(selection: { text: string; capturedAt: number } | null): string {
  if (!selection) return '';
  if (Date.now() - selection.capturedAt > LAST_SELECTION_COPY_GRACE_MS) return '';
  return selection.text;
}

// Keys held behind a paste that was not sent are not sent either; say so instead of
// dropping them silently.
function createInputQueue(): TerminalInputQueue {
  return new TerminalInputQueue((count) => {
    toast('Typed input not sent', {
      description: `${count === 1 ? 'A key' : `${count} keys`} typed after a paste that was not sent ${
        count === 1 ? 'was' : 'were'
      } discarded.`,
    });
  });
}

function createContextMenuRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export interface UsePtyOptions {
  /** Deterministic PTY session ID: makePtySessionId(projectId, scopeId, leafId). */
  sessionId: string;
  /** Pre-connected FrontendPty instance owned by the entity's PtySession store. */
  pty: FrontendPty;
  theme?: SessionTheme;
  /** Shell panes use macOS editing shortcuts; agents receive native Alt+arrows. */
  inputContext?: 'shell' | 'agent';
  mapShiftEnterToCtrlJ?: boolean;
  readOnly?: boolean;
  onActivity?: () => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onInterruptPress?: () => void;
  onPasteFromClipboard?: PasteFromClipboardHandler;
}

export interface UseTerminalReturn {
  focus: () => void;
  setTheme: (theme: SessionTheme) => void;
  /** Sends input in order behind any queued paste. */
  sendInput: (data: string, options?: { track?: boolean }) => void;
  /** Queues a paste; input sent after this call is delivered after the paste. */
  queuePaste: TerminalInputQueue['paste'];
  /**
   * Pastes prepared clipboard text through xterm, which normalizes line breaks and applies
   * the negotiated bracketed-paste framing, then sends the result once. Only for a queued
   * paste's commit; resolves false when the terminal did not confirm it.
   */
  pasteText: (text: string) => Promise<boolean>;
  /** Sends input immediately. Only for a queued paste's commit. */
  deliverInput: (data: string, options?: { track?: boolean }) => Promise<boolean>;
}

export type TerminalPasteHelpers = Pick<
  UseTerminalReturn,
  'focus' | 'queuePaste' | 'pasteText' | 'deliverInput'
>;

export type PasteFromClipboardHandler = (
  helpers: TerminalPasteHelpers,
  source: ClipboardSource
) => void;

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
 * When inside a PaneSizingContextProvider the terminal is pre-resized to the pane's
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
    inputContext = 'shell',
    mapShiftEnterToCtrlJ,
    readOnly = false,
    onActivity,
    onFirstMessage,
    onEnterPress,
    onInterruptPress,
    onPasteFromClipboard,
  } = options;

  // Stable refs for callbacks so the effect doesn't re-run on every render.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
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
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const inputContextRef = useRef(inputContext);
  inputContextRef.current = inputContext;

  // The per-pane controller owns PTY backend resizes (broadcast to ALL sessions)
  // and exposes an observable controllerDims box so this terminal can call
  // term.resize() reactively. PtyPane guarantees a context is always present by
  // self-provisioning a PaneDimensionProvider + PaneSizingContextProvider when
  // no ancestor provides one.
  const paneSizing = usePaneSizingContext();
  // Ref so the main effect (which only re-runs on sessionId change) always
  // accesses the latest context value without needing it as a dependency.
  const paneSizingRef = useRef(paneSizing);
  paneSizingRef.current = paneSizing;

  // Core xterm.js reference, kept alive across renders.
  const termRef = useRef<Terminal | null>(null);

  // Tracks submitted user input while filtering terminal control traffic and pasted frames.
  const submittedInputBufferRef = useRef(new SubmittedInputBuffer());
  const firstMessageSentRef = useRef(false);
  // Orders typed input behind pastes that are still acquiring or committing. One queue per
  // terminal input lifetime: replacing the terminal or its read-only state closes it.
  const inputQueueRef = useRef<TerminalInputQueue | null>(null);
  inputQueueRef.current ??= createInputQueue();
  // Collects the transport results of input emitted by the current terminal.paste() call.
  const pasteDeliveriesRef = useRef<Promise<boolean>[] | null>(null);

  // Auto-copy on selection
  const autoCopyOnSelectionRef = useRef(false);
  const lastSelectionRef = useRef<{ text: string; capturedAt: number } | null>(null);
  // The open context menu's request and the text it offers to copy, captured when it opened.
  const contextMenuRequestRef = useRef<{
    id: string;
    selectionText: string;
    linkText: string | null;
  } | null>(null);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  // Calibrates the per-pane controller with the mounted terminal's real cell
  // metrics. The controller recomputes cols/rows, updates controllerDims, and
  // broadcasts runtime resize calls to ALL sessions. The MobX reaction below then
  // applies term.resize() to the visible grid.
  //
  // Cold-path retry: the terminal is opened off-DOM so xterm's font measurement
  // may not be populated yet on the first call — retries up to 5 times.
  //
  // Runs synchronously so the xterm DOM catches up in the same paint as the
  // new container size (ENG-1577).
  const measureAndResize = useCallback(
    (retries = 0) => {
      try {
        const term = termRef.current;
        if (!term) return;
        const pane = paneSizingRef.current;
        if (!pane) {
          log.warn('useTerminal: no PaneSizingContext — cannot calibrate', { sessionId });
          return;
        }

        const cell = getCellMetrics(term);
        if (!cell) {
          // Cold-path: terminal was opened off-DOM so xterm's font measurement
          // hasn't populated yet.  Retry up to 5 times to avoid an infinite loop.
          if (retries < 5) {
            setTimeout(() => measureAndResizeRef.current(retries + 1), 100);
          }
          return;
        }

        // Calibrate the controller with exact cell metrics.
        // The controller recomputes cols/rows, updates controllerDims, and
        // broadcasts runtime resize calls to all sessions. The MobX reaction below
        // applies term.resize() when controllerDims changes.
        pane.calibrateCell(cell.width, cell.height);
      } catch (e) {
        log.warn('useTerminal: measureAndResize failed', { sessionId, error: e });
      }
    },
    [sessionId]
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
    // Don't steal focus from an open modal — unless this terminal is rendered
    // inside it (e.g. the agent sign-in terminal).
    const dialog = document.activeElement?.closest('[role="dialog"]');
    if (dialog && !dialog.contains(containerRef.current)) return;
    termRef.current?.focus();
  }, [containerRef]);

  // Copies go through the desktop clipboard sequence, so they land in gesture order.
  const copyText = useCallback((text: string) => {
    if (!text) return;
    void copyTextToClipboard(text)
      .then((result) => {
        if (!result.success) throw new Error(result.error ?? 'Clipboard write failed');
      })
      .catch((error) => {
        log.warn('useTerminal: failed to copy terminal text', { error });
        toast.error('Copy failed', {
          description: 'The terminal text could not be copied to the clipboard.',
        });
      });
  }, []);

  const copySelectionToClipboard = useCallback(() => {
    // Snapshot xterm's selection model now: it joins soft-wrapped rows and keeps real breaks.
    copyText(termRef.current?.getSelection() || getRecentSelection(lastSelectionRef.current));
  }, [copyText]);

  // Submitted-input tracking runs here, in the order input is actually sent.
  const deliverInput = useCallback(
    (data: string, options?: { track?: boolean }): Promise<boolean> => {
      if (readOnlyRef.current) return Promise.resolve(false);
      const shouldTrack = options?.track ?? true;
      if (shouldTrack) {
        const submittedMessages = submittedInputBufferRef.current.feed(data);
        for (const message of submittedMessages) {
          if (!firstMessageSentRef.current && onFirstMessageRef.current) {
            firstMessageSentRef.current = true;
            onFirstMessageRef.current(message);
          }
          if (isRealTaskInput(message)) {
            onEnterPressRef.current?.(message);
          }
        }
      }
      const delivered = pty.sendInput(data);
      pasteDeliveriesRef.current?.push(delivered);
      return delivered;
    },
    [pty]
  );

  const sendInput = useCallback(
    (data: string, options?: { track?: boolean }) => {
      inputQueueRef.current?.send(() => void deliverInput(data, options));
    },
    [deliverInput]
  );

  const queuePaste = useCallback<TerminalInputQueue['paste']>(
    (content, commit, onError, onCancel) =>
      inputQueueRef.current?.paste(content, commit, onError, onCancel),
    []
  );

  const closeInputLifetime = useCallback(() => {
    inputQueueRef.current?.close();
    inputQueueRef.current = createInputQueue();
  }, []);

  const pasteText = useCallback(
    (text: string) => {
      const deliveries: Promise<boolean>[] = [];
      pasteDeliveriesRef.current = deliveries;
      try {
        // xterm emits the converted paste through onData synchronously.
        pty.terminal.paste(text);
      } finally {
        pasteDeliveriesRef.current = null;
      }
      if (deliveries.length === 0) return Promise.resolve(false);
      return Promise.all(deliveries).then((results) => results.every(Boolean));
    },
    [pty]
  );

  useEffect(() => {
    pty.terminal.options.disableStdin = readOnly;
    return () => {
      pty.terminal.options.disableStdin = false;
      closeInputLifetime();
    };
  }, [pty, readOnly, closeInputLifetime]);

  // Application-owned paste gestures (shortcuts, context menu, Linux middle click) go to the
  // pane's clipboard pipeline; a read-only pane provides none, so they paste nothing.
  const pasteFromClipboard = useCallback(
    (source: ClipboardSource = 'clipboard') => {
      onPasteFromClipboardRef.current?.({ focus, queuePaste, pasteText, deliverInput }, source);
    },
    [focus, queuePaste, pasteText, deliverInput]
  );

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

    // Pane path: prefer the controller's current dims (already correct for the
    // pane size); fall back to a fresh pixel measurement if the controller
    // hasn't computed yet (e.g. very first mount before any calibration).
    if (pane) {
      targetDims = pane.getCurrentDimensions() ?? undefined;
      if (!targetDims && pane.containerRef.current && prevCell) {
        // Mirror the controller's padding exactly so the pre-mount dims match
        // what the controller will compute on first calibration.
        const measured = measureDimensions(
          pane.containerRef.current,
          prevCell.width,
          prevCell.height,
          0,
          TERMINAL_PADDING_PX,
          { bottom: pane.bottomPadding }
        );
        if (measured) targetDims = measured;
      }
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
      // resized while this session was off-screen.
      // Pane path: calibrate the controller cell metrics so it recomputes
      //   cols/rows and applies term.resize() via the controllerDims reaction.
      // Standalone path: measure locally and queue PTY resize.
      measureAndResize();

      // ── Load settings ──────────────────────────────────────────────────────
      // Settings belong to this mount: if they arrive after it ended or the terminal was
      // disposed, applying them would resize a parked or released terminal.
      let mounted = true;
      cleanups.push(() => {
        mounted = false;
      });
      let customFontFamily = '';
      void getAppSettingsClient()
        .then(async (client) => {
          const settings = (await client.get({
            key: 'terminal',
          })) as AppSettings['terminal'];
          return settings;
        })
        .then((terminalSettings) => {
          if (!mounted || frontendPty.disposed.aborted) return;
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
        });

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
              void deliverInput(`\x1b[${mode};0$y`, { track: false });
              return true;
            }
          );
          const decDisp = parser.registerCsiHandler(
            { prefix: '?', intermediates: '$', final: 'p' },
            (params: (number | number[])[]) => {
              const mode = (params[0] as number) ?? 0;
              void deliverInput(`\x1b[?${mode};0$y`, { track: false });
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
        // Ignore keys while a modal is open — unless this terminal is the one
        // rendered inside it (e.g. the agent sign-in terminal).
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog && !dialog.contains(container)) return false;

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

        if (inputContextRef.current === 'shell') {
          const optionArrowSequence = getMacOptionArrowSequence(event, IS_MAC_PLATFORM);
          if (optionArrowSequence) {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            sendInput(optionArrowSequence);
            return false;
          }
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
      const replies = createTerminalReplyClassifier(terminal);
      cleanups.push(() => replies.dispose());
      const handleTerminalInput = (data: string) => {
        onActivityRef.current?.();

        if (!data) return;
        // A queued paste's own terminal.paste() output is the commit being delivered.
        if (pasteDeliveriesRef.current) void deliverInput(data);
        // Replies answer the program now; they are never held behind a paste or tracked.
        else if (replies.isReply(data)) void deliverInput(data, { track: false });
        else sendInput(data);
      };

      const inputDisposable = terminal.onData((data) => handleTerminalInput(data));
      cleanups.push(() => inputDisposable.dispose());

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

      // ── Native copy (Edit > Copy) ──────────────────────────────────────────
      // Runs before xterm's own copy listener so the selection is written once, through the
      // same ordered clipboard sequence as shortcut and context-menu copies.
      const handleCopy = (event: ClipboardEvent) => {
        if (!terminal.hasSelection()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        copyText(terminal.getSelection());
      };
      frontendPty.ownedContainer.addEventListener('copy', handleCopy, true);
      cleanups.push(() => frontendPty.ownedContainer.removeEventListener('copy', handleCopy, true));

      // ── Linux primary selection (middle click) ─────────────────────────────
      // Application-owned like the paste shortcuts: preventing the middle-button mouseup
      // stops Chromium's own selection paste, and the pane reads PRIMARY in clipboard order.
      // A program tracking the mouse receives the click instead, unless Shift forces
      // selection (xterm then does not report it).
      const handlePrimaryPaste = (event: MouseEvent) => {
        if (!IS_LINUX_PLATFORM || event.button !== 1) return;
        if (terminal.modes.mouseTrackingMode !== 'none' && !event.shiftKey) return;
        event.preventDefault();
        pasteFromClipboard('selection');
      };
      frontendPty.ownedContainer.addEventListener('mouseup', handlePrimaryPaste, true);
      cleanups.push(() =>
        frontendPty.ownedContainer.removeEventListener('mouseup', handlePrimaryPaste, true)
      );

      // ── Native context menu ────────────────────────────────────────────────
      const handleContextMenuMouseDown = (event: MouseEvent) => {
        if (event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
      };
      const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const requestId = createContextMenuRequestId();
        const selectionText =
          terminal.getSelection() || getRecentSelection(lastSelectionRef.current);
        const linkText = getTerminalContextLink(terminal, event);
        contextMenuRequestRef.current = { id: requestId, selectionText, linkText };
        void getHostClient().then((client) =>
          client.showTerminalContextMenu({
            requestId,
            selectionText,
            linkText,
            x: event.clientX,
            y: event.clientY,
          })
        );
      };
      let disposedContextMenu = false;
      let offTerminalContextMenuAction: (() => void) | undefined;
      void getHostClient().then(async (client) => {
        const unsubscribe = await client.events.subscribe(undefined, {
          onEvent: (event) => {
            const request = contextMenuRequestRef.current;
            if (event.type !== 'terminal-context-menu-action' || event.requestId !== request?.id) {
              return;
            }
            contextMenuRequestRef.current = null;

            if (event.action === 'copy') copyText(request.selectionText);
            else if (event.action === 'copy-link') copyText(request.linkText?.trim() ?? '');
            else if (event.action === 'paste') pasteFromClipboard();
            else if (event.action === 'select-all') terminal.selectAll();
            else if (event.action === 'clear') frontendPty.clear();
          },
          onGap: () => {},
        });
        if (disposedContextMenu) unsubscribe();
        else offTerminalContextMenuAction = unsubscribe;
      });
      frontendPty.ownedContainer.addEventListener('mousedown', handleContextMenuMouseDown, true);
      frontendPty.ownedContainer.addEventListener('contextmenu', handleContextMenu);
      cleanups.push(() => {
        disposedContextMenu = true;
        offTerminalContextMenuAction?.();
        contextMenuRequestRef.current = null;
        frontendPty.ownedContainer.removeEventListener(
          'mousedown',
          handleContextMenuMouseDown,
          true
        );
        frontendPty.ownedContainer.removeEventListener('contextmenu', handleContextMenu);
      });

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

      // ── Resize trigger ────────────────────────────────────────────────────
      // React to controllerDims — the observable box updated by the per-pane
      // resize controller when pane pixel dimensions or cell size changes.
      // The controller owns PTY backend broadcasts; here we only apply
      // term.resize() to keep the visible xterm grid in sync. The reaction
      // fires synchronously within the ResizeObserver → MobX action → reaction
      // chain, preserving the "resize before next paint" guarantee (ENG-1577).
      const paneAtMount = paneSizingRef.current;
      if (paneAtMount) {
        const disposeReaction = reaction(
          () => paneAtMount.controllerDims.get(),
          (dims) => {
            if (!dims) return;
            const term = termRef.current;
            if (!term) return;
            if (term.cols !== dims.cols || term.rows !== dims.rows) {
              term.resize(dims.cols, dims.rows);
            }
          }
        );
        cleanups.push(disposeReaction);
      }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      // controllerDims reaction and other cleanups run BEFORE unmount —
      // preserving the invariant that they are torn down before the
      // ownedContainer is reparented off-screen.
      for (const fn of cleanups) {
        try {
          fn();
        } catch {}
      }
      // Return terminal's ownedContainer to the off-screen host only if this
      // React host still owns it. A terminal session can be reparented into a
      // different surface before this cleanup runs; in that case, unmounting
      // here would steal the xterm DOM back from the new owner.
      if (container.contains(pty.ownedContainer)) {
        pty.unmount();
      }
      termRef.current = null;
      firstMessageSentRef.current = false;
      submittedInputBufferRef.current = new SubmittedInputBuffer();
      closeInputLifetime();
    };
    // oxlint-disable-next-line react/exhaustive-deps
  }, [sessionId, pty]); // Re-run only when the session changes

  // ── Theme update (after initial mount) ──────────────────────────────────────
  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  return { focus, setTheme, sendInput, queuePaste, pasteText, deliverInput };
}

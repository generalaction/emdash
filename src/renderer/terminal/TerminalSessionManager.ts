import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ensureTerminalHost } from './terminalHost';
import { TerminalInputBuffer } from './TerminalInputBuffer';
import { classifyActivity } from '../lib/activityClassifier';
import { TerminalMetrics } from './TerminalMetrics';
import { log } from '../lib/logger';
import { TERMINAL_SNAPSHOT_VERSION, type TerminalSnapshotPayload } from '#types/terminalSnapshot';
import { pendingInjectionManager } from '../lib/PendingInjectionManager';
import { getProvider, type ProviderId } from '@shared/providers/registry';
import {
  CTRL_J_ASCII,
  shouldCopySelectionFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
} from './terminalKeybindings';

const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_DATA_WINDOW_BYTES = 128 * 1024 * 1024; // 128 MB soft guardrail
const FALLBACK_FONTS = 'Menlo, Monaco, Courier New, monospace';
const MIN_RENDERABLE_TERMINAL_WIDTH_PX = 24;
const MIN_RENDERABLE_TERMINAL_HEIGHT_PX = 24;
const PTY_RESIZE_DEBOUNCE_MS = 60;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;
const PANEL_RESIZE_DRAGGING_EVENT = 'emdash:panel-resize-dragging';
const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// Store viewport positions per terminal ID to preserve scroll position across detach/attach cycles
const viewportPositions = new Map<string, number>();

export interface SessionTheme {
  base: 'dark' | 'light';
  override?: ITerminalOptions['theme'];
}

export interface TerminalSessionOptions {
  taskId: string;
  cwd?: string;
  remote?: {
    connectionId: string;
  };
  providerId?: string; // If set, uses direct CLI spawn
  shell?: string; // Used for shell-based spawn when providerId not set
  env?: Record<string, string>;
  initialSize: { cols: number; rows: number };
  scrollbackLines: number;
  theme: SessionTheme;
  telemetry?: {
    track: (event: string, payload?: Record<string, unknown>) => void;
  } | null;
  autoApprove?: boolean;
  initialPrompt?: string;
  mapShiftEnterToCtrlJ?: boolean;
  disableSnapshots?: boolean;
  onLinkClick?: (url: string) => void;
  onFirstMessage?: (message: string) => void;
}

type CleanupFn = () => void;

export class TerminalSessionManager {
  readonly id: string;
  private readonly terminal: Terminal;
  private readonly fitAddon: FitAddon;
  private readonly serializeAddon: SerializeAddon;
  private readonly webLinksAddon: WebLinksAddon;
  private webglAddon: WebglAddon | null = null;
  private readonly metrics: TerminalMetrics;
  private readonly container: HTMLDivElement;
  private attachedContainer: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private disposables: CleanupFn[] = [];
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSnapshot: Promise<void> | null = null;
  private disposed = false;
  private opened = false;
  private readonly activityListeners = new Set<() => void>();
  private readonly readyListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly exitListeners = new Set<
    (info: { exitCode: number | undefined; signal?: number }) => void
  >();
  private firstFrameRendered = false;
  private ptyStarted = false;
  private lastSnapshotAt: number | null = null;
  private lastSnapshotReason: 'interval' | 'detach' | 'dispose' | null = null;
  private customFontFamily = '';
  private themeFontFamily = '';
  private pendingFitFrame: number | null = null;
  private pendingResizeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResize: { cols: number; rows: number } | null = null;
  private lastSentResize: { cols: number; rows: number } | null = null;
  private isPanelResizeDragging = false;
  private hadFocusBeforeDetach = false;
  private inputBuffer: TerminalInputBuffer | null = null;
  private autoCopyOnSelection = false;
  private selectionChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Timing for startup performance measurement
  private initStartTime: number = 0;
  private snapshotRestoreTime: number = 0;
  private ptyConnectStartTime: number = 0;

  constructor(private readonly options: TerminalSessionOptions) {
    this.initStartTime = performance.now();
    this.id = options.taskId;

    this.container = document.createElement('div');
    this.container.className = 'terminal-session-root';
    Object.assign(this.container.style, {
      width: '100%',
      height: '100%',
      display: 'block',
    } as CSSStyleDeclaration);
    ensureTerminalHost().appendChild(this.container);

    this.terminal = new Terminal({
      cols: options.initialSize.cols,
      rows: options.initialSize.rows,
      scrollback: options.scrollbackLines,
      convertEol: true,
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      allowProposedApi: true,
      scrollOnUserInput: false,
    });

    const updateCustomFont = (customFont?: string) => {
      this.customFontFamily = customFont?.trim() ?? '';
      this.applyEffectiveFont();
    };

    window.electronAPI.getSettings().then((result) => {
      updateCustomFont(result?.settings?.terminal?.fontFamily);
      this.autoCopyOnSelection = result?.settings?.terminal?.autoCopyOnSelection ?? false;
    });

    const handleFontChange = (e: Event) => {
      const detail = (e as CustomEvent<{ fontFamily?: string }>).detail;
      updateCustomFont(detail?.fontFamily);
      this.fitPreservingViewport();
    };
    window.addEventListener('terminal-font-changed', handleFontChange);
    this.disposables.push(() =>
      window.removeEventListener('terminal-font-changed', handleFontChange)
    );

    const handleAutoCopyChange = (e: Event) => {
      const detail = (e as CustomEvent<{ autoCopyOnSelection?: boolean }>).detail;
      this.autoCopyOnSelection = detail?.autoCopyOnSelection ?? false;
    };
    window.addEventListener('terminal-auto-copy-changed', handleAutoCopyChange);
    this.disposables.push(() =>
      window.removeEventListener('terminal-auto-copy-changed', handleAutoCopyChange)
    );

    const handlePanelResizeDragging = (e: Event) => {
      const detail = (e as CustomEvent<{ dragging?: boolean }>).detail;
      const dragging = Boolean(detail?.dragging);
      if (this.isPanelResizeDragging === dragging) return;
      this.isPanelResizeDragging = dragging;
      if (this.pendingResizeTimer) {
        clearTimeout(this.pendingResizeTimer);
        this.pendingResizeTimer = null;
      }
      if (dragging) return;
      this.flushQueuedResize();
    };
    window.addEventListener(
      PANEL_RESIZE_DRAGGING_EVENT,
      handlePanelResizeDragging as EventListener
    );
    this.disposables.push(() =>
      window.removeEventListener(
        PANEL_RESIZE_DRAGGING_EVENT,
        handlePanelResizeDragging as EventListener
      )
    );

    this.fitAddon = new FitAddon();
    this.serializeAddon = new SerializeAddon();

    // Initialize WebLinks addon with custom handler
    this.webLinksAddon = new WebLinksAddon((event, uri) => {
      // Prevent default behavior
      event.preventDefault();

      // Call the custom link handler if provided, otherwise use default behavior
      if (options.onLinkClick) {
        options.onLinkClick(uri);
      } else {
        // Fallback to opening directly via electronAPI
        window.electronAPI.openExternal(uri).catch((error) => {
          log.warn('Failed to open external link', { uri, error });
        });
      }
    });

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.loadAddon(this.webLinksAddon);

    // Work around xterm.js 6.0.0 bug: the built-in DECRQM (Request Mode)
    // handler crashes with "r is not defined" when TUI apps (e.g. Amp) send
    // mode-query escape sequences (CSI Ps $ p / CSI ? Ps $ p).
    // Register custom handlers that intercept these sequences before the
    // buggy built-in handler runs, and send back a proper DECRPM response
    // reporting each queried mode as "not recognized" (Pm=0).
    // Response format: CSI [?] Ps ; Pm $ y
    try {
      const parser = (this.terminal as any).parser;
      if (parser?.registerCsiHandler) {
        const ptyId = this.id;
        // ANSI mode request: CSI Ps $ p  →  respond CSI Ps ; 0 $ y
        const ansiDisp = parser.registerCsiHandler(
          { intermediates: '$', final: 'p' },
          (params: (number | number[])[]) => {
            const mode = (params[0] as number) ?? 0;
            window.electronAPI.ptyInput({ id: ptyId, data: `\x1b[${mode};0$y` });
            return true;
          }
        );
        // DEC private mode request: CSI ? Ps $ p  →  respond CSI ? Ps ; 0 $ y
        const decDisp = parser.registerCsiHandler(
          { prefix: '?', intermediates: '$', final: 'p' },
          (params: (number | number[])[]) => {
            const mode = (params[0] as number) ?? 0;
            window.electronAPI.ptyInput({ id: ptyId, data: `\x1b[?${mode};0$y` });
            return true;
          }
        );
        this.disposables.push(
          () => ansiDisp.dispose(),
          () => decDisp.dispose()
        );
      }
    } catch (err) {
      log.warn('Failed to register DECRQM workaround handlers', { error: err });
    }

    try {
      this.webglAddon = new WebglAddon();
      this.webglAddon.onContextLoss?.(() => {
        try {
          this.webglAddon?.dispose();
        } catch {}
        this.webglAddon = null;
      });
      this.terminal.loadAddon(this.webglAddon);
    } catch {
      this.webglAddon = null;
    }

    this.applyTheme(options.theme);

    // Custom key event handler: always attached so the dialog guard
    // runs for every terminal, plus optional copy/Shift+Enter handling.
    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Don't let the terminal consume keystrokes while a dialog/modal
      // is open.  On Linux the terminal's hidden textarea can keep focus
      // after a dialog appears, sending input to the PTY instead of
      // dialog fields (see #940).
      if (document.querySelector('[role="dialog"]')) {
        return false;
      }

      if (shouldCopySelectionFromTerminal(event, IS_MAC_PLATFORM, this.terminal.hasSelection())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        this.copySelectionToClipboard();
        return false; // Prevent xterm from processing the copy shortcut
      }

      // Handle Ctrl+Shift+V paste on Linux
      if (shouldPasteToTerminal(event, IS_MAC_PLATFORM)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        this.pasteFromClipboard();
        return false; // Prevent xterm from processing the paste shortcut
      }

      if (options.mapShiftEnterToCtrlJ && shouldMapShiftEnterToCtrlJ(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();

        // Send Ctrl+J (line feed) instead of Shift+Enter
        // Pass true to skip injection handling - this is a newline insert, not a submit
        this.handleTerminalInput(CTRL_J_ASCII, true);
        return false; // Prevent xterm from processing the Shift+Enter
      }

      // Map Cmd+Left/Right to Ctrl+A/E on macOS (line navigation)
      if (IS_MAC_PLATFORM && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          this.handleTerminalInput('\x01', true);
          return false;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          this.handleTerminalInput('\x05', true);
          return false;
        }
      }

      return true; // Let xterm handle all other keys normally
    });

    this.metrics = new TerminalMetrics({
      maxDataWindowBytes: MAX_DATA_WINDOW_BYTES,
      telemetry: options.telemetry ?? null,
    });

    // Set up one-shot capture of the user's first terminal message
    if (options.onFirstMessage) {
      const callback = options.onFirstMessage;
      this.inputBuffer = new TerminalInputBuffer((message) => {
        callback(message);
      });
    }

    const inputDisposable = this.terminal.onData((data) => {
      this.handleTerminalInput(data);
    });
    const resizeDisposable = this.terminal.onResize(({ cols, rows }) => {
      if (this.disposed) return;
      this.queuePtyResize(cols, rows);
    });
    this.disposables.push(
      () => inputDisposable.dispose(),
      () => resizeDisposable.dispose()
    );

    void this.initializeTerminal();
  }

  attach(container: HTMLElement) {
    if (this.disposed) {
      throw new Error(`Terminal session ${this.id} is already disposed`);
    }
    if (this.attachedContainer === container) return;

    this.detach();

    container.appendChild(this.container);
    this.attachedContainer = container;
    if (!this.opened) {
      this.terminal.open(this.container);
      this.opened = true;
      const element = (this.terminal as any).element as HTMLElement | null;
      if (element) {
        element.style.width = '100%';
        element.style.height = '100%';
      }

      const selectionDisposable = this.terminal.onSelectionChange(() => {
        if (!this.autoCopyOnSelection || this.disposed) return;
        if (!this.terminal.hasSelection()) return;
        if (this.selectionChangeDebounceTimer) {
          clearTimeout(this.selectionChangeDebounceTimer);
        }
        this.selectionChangeDebounceTimer = setTimeout(() => {
          try {
            if (!this.disposed && this.terminal.hasSelection()) {
              this.copySelectionToClipboard();
            }
          } catch (error) {
            log.warn('Auto-copy on selection failed', { id: this.id, error });
          }
        }, 150);
      });
      this.disposables.push(() => {
        if (this.selectionChangeDebounceTimer) {
          clearTimeout(this.selectionChangeDebounceTimer);
          this.selectionChangeDebounceTimer = null;
        }
        selectionDisposable.dispose();
      });
    }

    this.scheduleFit();

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleFit();
    });
    this.resizeObserver.observe(container);

    const shouldRestoreFocus = this.hadFocusBeforeDetach;
    this.hadFocusBeforeDetach = false;

    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.scheduleFit();
      // Restore viewport position after fit completes and terminal is fully rendered
      // Use a second requestAnimationFrame to ensure the terminal buffer is ready
      requestAnimationFrame(() => {
        if (!this.disposed) {
          this.restoreViewportPosition();
          if (shouldRestoreFocus) {
            this.terminal.focus();
          }
        }
      });
    });

    // Only start snapshot timer if snapshots are enabled (main chats only)
    if (!this.options.disableSnapshots) {
      this.startSnapshotTimer();
    }
  }

  detach() {
    if (this.attachedContainer) {
      // Capture viewport position before detaching
      const textarea = this.container.querySelector('.xterm-helper-textarea');
      this.hadFocusBeforeDetach = textarea != null && textarea === document.activeElement;

      this.captureViewportPosition();
      this.cancelScheduledFit();
      this.clearQueuedResize();
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      ensureTerminalHost().appendChild(this.container);
      this.attachedContainer = null;
      this.stopSnapshotTimer();
      // Only capture snapshot on detach if snapshots are enabled
      if (!this.options.disableSnapshots) {
        void this.captureSnapshot('detach');
      }
    }
  }

  setTheme(theme: SessionTheme) {
    this.applyTheme(theme);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.stopSnapshotTimer();
    this.cancelScheduledFit();
    this.clearQueuedResize();
    // Only capture final snapshot if snapshots are enabled
    if (!this.options.disableSnapshots) {
      void this.captureSnapshot('dispose');
    }
    // Clean up stored viewport position when session is disposed
    viewportPositions.delete(this.id);
    try {
      window.electronAPI.ptyKill(this.id);
    } catch (error) {
      log.warn('Failed to kill PTY during dispose', { id: this.id, error });
    }
    for (const dispose of this.disposables.splice(0)) {
      try {
        dispose();
      } catch (error) {
        log.warn('Terminal session dispose callback failed', {
          id: this.id,
          error,
        });
      }
    }
    this.inputBuffer = null;
    this.metrics.dispose();
    this.activityListeners.clear();
    this.readyListeners.clear();
    this.errorListeners.clear();
    this.exitListeners.clear();
    this.terminal.dispose();
    // Remove the container from the DOM to prevent orphaned nodes from accumulating
    // in the terminal host, retaining xterm buffer memory across task switches.
    try {
      this.container.remove();
    } catch {}
  }

  focus() {
    // Don't steal focus from open dialogs (e.g. New Task modal).
    // On Linux/Wayland the terminal's hidden textarea can retain focus
    // after a dialog opens, causing keystrokes to go to the PTY instead
    // of dialog inputs.
    if (document.activeElement?.closest('[role="dialog"]')) return;

    this.terminal.focus();
  }

  scrollToBottom() {
    try {
      this.terminal.scrollToBottom();
    } catch (error) {
      log.warn('Failed to scroll to bottom', { id: this.id, error });
    }
  }

  registerActivityListener(listener: () => void): () => void {
    this.activityListeners.add(listener);
    return () => {
      this.activityListeners.delete(listener);
    };
  }

  registerReadyListener(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  registerErrorListener(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  registerExitListener(
    listener: (info: { exitCode: number | undefined; signal?: number }) => void
  ): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  private handleTerminalInput(data: string, isNewlineInsert: boolean = false) {
    this.emitActivity();
    if (this.disposed) return;

    // Filter out focus reporting sequences (CSI I = focus in, CSI O = focus out) only if PTY hasn't started yet.
    // This prevents raw escape sequences from appearing in the terminal before the CLI is ready,
    // while still allowing apps that request them (like vim) to receive them once running.
    let filtered = data;
    if (!this.ptyStarted) {
      filtered = data.replace(/\x1b\[I|\x1b\[O/g, '');
    }

    if (!filtered) return;

    // Feed input to the buffer for first-message capture
    if (this.inputBuffer && !this.inputBuffer.isComplete) {
      this.inputBuffer.feed(filtered);
    }

    // Track command execution when Enter is pressed (but not for newline inserts)
    const isEnterPress = filtered.includes('\r') || filtered.includes('\n');
    if (isEnterPress && !isNewlineInsert) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('terminal_command_executed');
      })();
    }

    // Check for pending injection text when Enter is pressed (but not for newline inserts)
    const pendingText = pendingInjectionManager.getPending();
    if (pendingText && isEnterPress && !isNewlineInsert) {
      // Append pending text to the existing input and keep the prior working behavior.
      const stripped = filtered.replace(/[\r\n]+$/g, '');
      const enterSequence = filtered.includes('\r') ? '\r' : '\n';
      const injectedData = stripped + pendingText + enterSequence + enterSequence;
      window.electronAPI.ptyInput({ id: this.id, data: injectedData });
      pendingInjectionManager.markUsed();
      return;
    }

    window.electronAPI.ptyInput({ id: this.id, data: filtered });
  }

  private cleanTerminalText(text: string): string {
    if (!text) return text;

    let cleaned = text;

    cleaned = cleaned.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    cleaned = cleaned.replace(/\x1b\][^\x07\x1b\\]*(\x07|\x1b\\)?/g, '');
    cleaned = cleaned.replace(/\x1bP[^\x1b\\]*(\x1b\\)?/g, '');
    cleaned = cleaned.replace(/\x1b[^\[P\]][\x20-\x7e]*/g, '');

    cleaned = cleaned.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    cleaned = cleaned
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n');

    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    cleaned = cleaned.trim();

    return cleaned;
  }

  private copySelectionToClipboard() {
    try {
      const selected = this.terminal.getSelection();
      if (!selected) return;

      const cleaned = this.cleanTerminalText(selected);

      const writeWithElectronFallback = () => {
        const fallbackWrite = (window as any)?.electronAPI?.clipboardWriteText;
        if (typeof fallbackWrite !== 'function') {
          log.warn('Terminal clipboard API unavailable', { id: this.id });
          return;
        }

        void fallbackWrite(cleaned).catch((error: unknown) => {
          log.warn('Failed to copy terminal selection via Electron fallback', {
            id: this.id,
            error,
          });
        });
      };

      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        void navigator.clipboard.writeText(cleaned).catch((error) => {
          log.warn('Failed to copy terminal selection via navigator clipboard, falling back', {
            id: this.id,
            error,
          });
          writeWithElectronFallback();
        });
        return;
      }

      writeWithElectronFallback();
    } catch (error) {
      log.warn('Failed to copy terminal selection', { id: this.id, error });
    }
  }

  /**
   * Paste text from clipboard into the terminal using Electron's native paste.
   * Used for Ctrl+Shift+V on Linux.
   */
  private pasteFromClipboard() {
    const paste = window.electronAPI?.paste;
    if (typeof paste !== 'function') {
      log.warn('Terminal paste API unavailable', { id: this.id });
      return;
    }

    void paste().catch((error: unknown) => {
      log.warn('Failed to paste to terminal', {
        id: this.id,
        error,
      });
    });
  }

  private applyTheme(theme: SessionTheme) {
    const selection =
      theme.base === 'light'
        ? {
            selectionBackground: 'rgba(59, 130, 246, 0.35)',
            selectionForeground: '#0f172a',
          }
        : {
            selectionBackground: 'rgba(96, 165, 250, 0.35)',
            selectionForeground: '#f9fafb',
          };
    const base =
      theme.base === 'light'
        ? {
            background: '#ffffff',
            foreground: '#1f2933',
            cursor: '#1f2933',
            ...selection,
          }
        : {
            background: '#1f2937',
            foreground: '#f9fafb',
            cursor: '#f9fafb',
            ...selection,
          };

    // Extract font settings before applying theme (they're not part of ITheme)
    const fontFamily = (theme.override as any)?.fontFamily;
    const fontSize = (theme.override as any)?.fontSize;

    // Apply color theme (excluding font properties)
    const colorTheme = { ...theme.override };
    delete (colorTheme as any)?.fontFamily;
    delete (colorTheme as any)?.fontSize;
    this.terminal.options.theme = { ...base, ...colorTheme };

    // Apply font settings separately
    this.themeFontFamily = typeof fontFamily === 'string' ? fontFamily.trim() : '';
    this.applyEffectiveFont();
    if (fontSize) {
      this.terminal.options.fontSize = fontSize;
    }
  }

  private applyEffectiveFont() {
    const selected = this.customFontFamily || this.themeFontFamily;
    this.terminal.options.fontFamily = selected ? `${selected}, ${FALLBACK_FONTS}` : FALLBACK_FONTS;
  }

  private scheduleFit() {
    if (this.pendingFitFrame !== null) return;
    this.pendingFitFrame = requestAnimationFrame(() => {
      this.pendingFitFrame = null;
      if (this.disposed) return;
      this.fitPreservingViewport();
    });
  }

  private cancelScheduledFit() {
    if (this.pendingFitFrame !== null) {
      cancelAnimationFrame(this.pendingFitFrame);
      this.pendingFitFrame = null;
    }
  }

  private normalizeSize(cols: number, rows: number): { cols: number; rows: number } | null {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
    const normalizedCols = Math.max(MIN_TERMINAL_COLS, Math.floor(cols));
    const normalizedRows = Math.max(MIN_TERMINAL_ROWS, Math.floor(rows));
    return { cols: normalizedCols, rows: normalizedRows };
  }

  private queuePtyResize(cols: number, rows: number, immediate = false) {
    const size = this.normalizeSize(cols, rows);
    if (!size) return;
    this.pendingResize = size;

    if (immediate && !this.isPanelResizeDragging) {
      this.flushQueuedResize();
      return;
    }

    if (this.isPanelResizeDragging) {
      return;
    }

    if (this.pendingResizeTimer) {
      clearTimeout(this.pendingResizeTimer);
    }
    this.pendingResizeTimer = setTimeout(() => {
      this.pendingResizeTimer = null;
      this.flushQueuedResize();
    }, PTY_RESIZE_DEBOUNCE_MS);
  }

  private clearQueuedResize() {
    if (this.pendingResizeTimer) {
      clearTimeout(this.pendingResizeTimer);
      this.pendingResizeTimer = null;
    }
    this.pendingResize = null;
  }

  private flushQueuedResize() {
    if (!this.ptyStarted || this.disposed || !this.pendingResize) return;
    const { cols, rows } = this.pendingResize;
    this.pendingResize = null;

    if (this.lastSentResize?.cols === cols && this.lastSentResize?.rows === rows) return;

    try {
      window.electronAPI.ptyResize({ id: this.id, cols, rows });
      this.lastSentResize = { cols, rows };
    } catch (error) {
      log.warn('Terminal resize sync failed', { id: this.id, error });
    }
  }

  /**
   * Fit the terminal to its container while preserving the user's viewport
   * position (prevents jumps when sidebars resize and trigger fits).
   */
  private fitPreservingViewport() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width < MIN_RENDERABLE_TERMINAL_WIDTH_PX || height < MIN_RENDERABLE_TERMINAL_HEIGHT_PX) {
      return;
    }

    try {
      const buffer = this.terminal.buffer?.active;
      const offsetFromBottom =
        buffer && typeof buffer.baseY === 'number' && typeof buffer.viewportY === 'number'
          ? buffer.baseY - buffer.viewportY
          : null;

      this.fitAddon.fit();

      // Use requestAnimationFrame to ensure terminal is fully rendered before restoring scroll position
      // This prevents viewport jumps when sidebars resize
      if (offsetFromBottom !== null) {
        requestAnimationFrame(() => {
          if (this.disposed) return;
          try {
            const newBuffer = this.terminal.buffer?.active;
            const targetBase = newBuffer?.baseY ?? null;
            if (typeof targetBase === 'number') {
              const targetLine = Math.max(0, targetBase - offsetFromBottom);
              this.terminal.scrollToLine(targetLine);
            }
          } catch (error) {
            log.warn('Terminal scroll restore failed after fit', {
              id: this.id,
              error,
            });
          }
        });
      }
    } catch (error) {
      log.warn('Terminal fit failed', { id: this.id, error });
    }
  }

  /**
   * Capture the current viewport position (scroll offset from bottom)
   * and store it for later restoration.
   */
  private captureViewportPosition() {
    try {
      const buffer = this.terminal.buffer?.active;
      if (buffer && typeof buffer.baseY === 'number' && typeof buffer.viewportY === 'number') {
        const offsetFromBottom = buffer.baseY - buffer.viewportY;
        viewportPositions.set(this.id, offsetFromBottom);
      }
    } catch (error) {
      log.warn('Failed to capture viewport position', { id: this.id, error });
    }
  }

  /**
   * Restore the previously captured viewport position.
   * This ensures the terminal stays at the same scroll position when switching
   * between tasks or when the terminal is reattached.
   */
  private restoreViewportPosition() {
    try {
      const storedOffset = viewportPositions.get(this.id);
      if (typeof storedOffset === 'number') {
        const buffer = this.terminal.buffer?.active;
        if (buffer && typeof buffer.baseY === 'number') {
          const targetLine = Math.max(0, buffer.baseY - storedOffset);
          this.terminal.scrollToLine(targetLine);
        }
      }
    } catch (error) {
      log.warn('Failed to restore viewport position', { id: this.id, error });
    }
  }

  private startSnapshotTimer() {
    this.stopSnapshotTimer();
    this.snapshotTimer = setInterval(() => {
      void this.captureSnapshot('interval');
    }, SNAPSHOT_INTERVAL_MS);
  }

  private stopSnapshotTimer() {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  /**
   * Initialize terminal: connect to PTY and conditionally restore snapshot.
   *
   * For CLIs with resume capability (claude, codex):
   * - Hot reload (PTY reused): restore snapshot for visual continuity
   * - Full restart: skip snapshot, let CLI show history via resume flag
   *
   * For CLIs without resume:
   * - Always restore snapshot for visual context
   */
  private async initializeTerminal(): Promise<void> {
    // Check if snapshot exists (indicates previous session)
    const snapshot = await this.fetchSnapshot();
    const hasSnapshot = !!snapshot;

    // Connect to PTY - pass resume flag if we have a previous session
    const result = await this.connectPty(hasSnapshot);

    // Decide whether to restore snapshot based on PTY result
    try {
      if (result?.reused) {
        // Hot reload - PTY still running, restore snapshot for visual continuity
        if (snapshot) {
          this.applySnapshot(snapshot);
        }
      } else if (!this.providerHasResume()) {
        // Full restart with non-resume CLI - show snapshot for context
        if (snapshot) {
          this.applySnapshot(snapshot);
        }
      }
      // For full restart with resume CLI - skip snapshot, CLI handles history
    } catch (err) {
      log.warn('terminalSession:applySnapshotError', { id: this.id, error: err });
    }
  }

  private providerHasResume(): boolean {
    const { providerId } = this.options;
    if (!providerId) return false;
    const provider = getProvider(providerId as ProviderId);
    return !!provider?.resumeFlag;
  }

  private async fetchSnapshot(): Promise<any | null> {
    if (this.options.disableSnapshots) return null;
    if (!window.electronAPI.ptyGetSnapshot) return null;

    try {
      const response = await window.electronAPI.ptyGetSnapshot({ id: this.id });
      if (!response?.ok || !response.snapshot?.data) return null;
      if (response.snapshot.version && response.snapshot.version !== TERMINAL_SNAPSHOT_VERSION) {
        return null;
      }
      return response.snapshot;
    } catch {
      return null;
    }
  }

  private applySnapshot(snapshot: any): void {
    if (typeof snapshot.data === 'string' && snapshot.data.length > 0) {
      this.terminal.reset();
      this.terminal.write(snapshot.data);
    }
    if (snapshot.cols && snapshot.rows) {
      this.terminal.resize(snapshot.cols, snapshot.rows);
    }
  }

  private async connectPty(
    hasExistingSession: boolean = false
  ): Promise<{ ok: boolean; reused?: boolean; error?: string }> {
    this.ptyConnectStartTime = performance.now();
    const { taskId, cwd, providerId, shell, env, initialSize, autoApprove, initialPrompt } =
      this.options;
    const id = taskId;

    // Provider CLIs use direct spawn (bypasses shell config loading)
    // Regular shell terminals use shell-based spawn
    const ptyPromise =
      providerId && cwd
        ? window.electronAPI.ptyStartDirect({
            id,
            providerId,
            cwd,
            remote: this.options.remote,
            cols: initialSize.cols,
            rows: initialSize.rows,
            autoApprove,
            initialPrompt,
            env,
            resume: hasExistingSession,
          })
        : window.electronAPI.ptyStart({
            id,
            cwd,
            remote: this.options.remote,
            shell,
            env,
            cols: initialSize.cols,
            rows: initialSize.rows,
            autoApprove,
            initialPrompt,
          });

    const result = await ptyPromise.catch((error: any) => {
      const message = error?.message || String(error);
      log.error('terminalSession:ptyStartError', { id, error });
      this.emitError(message);
      return { ok: false, error: message };
    });

    if (result?.ok) {
      this.ptyStarted = true;
      this.lastSentResize = null;
      this.sendSizeIfStarted();
      this.emitReady();
      try {
        let offStarted: (() => void) | undefined;
        const removeOffStartedFromDisposables = () => {
          if (!offStarted) return;
          const idx = this.disposables.indexOf(offStarted);
          if (idx >= 0) this.disposables.splice(idx, 1);
        };
        offStarted = window.electronAPI.onPtyStarted?.((payload: { id: string }) => {
          if (payload?.id === id) {
            this.ptyStarted = true;
            this.lastSentResize = null;
            this.sendSizeIfStarted();
            try {
              offStarted?.();
            } catch {}
            removeOffStartedFromDisposables();
            offStarted = undefined;
          }
        });
        if (offStarted) this.disposables.push(offStarted);
      } catch {}
    } else {
      const message = result?.error || 'Failed to start PTY';
      log.warn('terminalSession:ptyStartFailed', { id, error: message });
      this.emitError(message);
    }

    // Set up data listener (runs regardless of success for potential reuse)
    this.setupPtyDataListener(id);

    return result || { ok: false, error: 'Unknown error' };
  }

  private setupPtyDataListener(id: string): void {
    const offData = window.electronAPI.onPtyData(id, (chunk) => {
      if (!this.metrics.canAccept(chunk)) {
        log.warn('Terminal scrollback truncated to protect memory', { id });
        this.terminal.clear();
        this.terminal.writeln('[scrollback truncated to protect memory]');
      }
      const buffer = this.terminal.buffer?.active;
      const isAtBottom = buffer ? buffer.baseY - buffer.viewportY <= 2 : true;

      // Check if agent started processing — confirms the user's input was accepted
      if (this.inputBuffer && !this.inputBuffer.isComplete) {
        const signal = classifyActivity(this.options.providerId ?? null, chunk);
        if (signal === 'busy') {
          this.inputBuffer.confirmSubmit();
        }
      }

      try {
        this.terminal.write(chunk);
      } catch (err) {
        // Guard against xterm.js parser errors (e.g. DECRQM "r is not defined"
        // in 6.0.0). Log once and continue — the terminal session stays usable.
        log.warn('terminalSession:writeError', { id: this.id, error: (err as Error)?.message });
      }
      if (!this.firstFrameRendered) {
        this.firstFrameRendered = true;
        const firstFrameTime = performance.now() - this.initStartTime;
        log.info('terminalSession:firstFrame timing', {
          id: this.id,
          firstFrameMs: Math.round(firstFrameTime),
        });
        try {
          this.terminal.refresh(0, this.terminal.rows - 1);
        } catch {}
      }

      if (isAtBottom) {
        this.terminal.scrollToBottom();
      }
    });

    const offExit = window.electronAPI.onPtyExit(id, (info) => {
      this.metrics.recordExit(info);
      this.ptyStarted = false;
      this.clearQueuedResize();
      this.emitExit(info);
    });

    this.disposables.push(offData, offExit);
  }

  private captureSnapshot(reason: 'interval' | 'detach' | 'dispose'): Promise<void> {
    if (!window.electronAPI.ptySaveSnapshot) return Promise.resolve();
    if (this.disposed) return Promise.resolve();
    // Skip snapshots for non-main chats
    if (this.options.disableSnapshots) return Promise.resolve();
    if (reason === 'detach' && this.lastSnapshotReason === 'detach' && this.lastSnapshotAt) {
      const elapsed = Date.now() - this.lastSnapshotAt;
      if (elapsed < 1500) return Promise.resolve();
    }

    const now = new Date().toISOString();
    const task = (async () => {
      try {
        const data = this.serializeAddon.serialize();
        if (!data && reason === 'detach') return;

        const payload: TerminalSnapshotPayload = {
          version: TERMINAL_SNAPSHOT_VERSION,
          createdAt: now,
          cols: this.terminal.cols,
          rows: this.terminal.rows,
          data,
          stats: { ...this.metrics.snapshot(), reason },
        };

        const result = await window.electronAPI.ptySaveSnapshot({
          id: this.id,
          payload,
        });
        if (!result?.ok) {
          log.warn('Terminal snapshot save failed', {
            id: this.id,
            error: result?.error,
          });
        } else {
          this.metrics.markSnapshot();
        }
      } catch (error) {
        log.warn('terminalSession:snapshotCaptureFailed', {
          id: this.id,
          error: (error as Error)?.message ?? String(error),
          reason,
        });
      }
    })();

    this.pendingSnapshot = task;
    return task.finally(() => {
      if (this.pendingSnapshot === task) {
        this.pendingSnapshot = null;
      }
      this.lastSnapshotAt = Date.now();
      this.lastSnapshotReason = reason;
    });
  }

  private emitActivity() {
    for (const listener of this.activityListeners) {
      try {
        listener();
      } catch (error) {
        log.warn('Terminal activity listener failed', { id: this.id, error });
      }
    }
  }

  private emitReady() {
    for (const listener of this.readyListeners) {
      try {
        listener();
      } catch (error) {
        log.warn('Terminal ready listener failed', { id: this.id, error });
      }
    }
  }

  private emitError(message: string) {
    for (const listener of this.errorListeners) {
      try {
        listener(message);
      } catch (error) {
        log.warn('Terminal error listener failed', { id: this.id, error });
      }
    }
  }

  private emitExit(info: { exitCode: number | undefined; signal?: number }) {
    for (const listener of this.exitListeners) {
      try {
        listener(info);
      } catch (error) {
        log.warn('Terminal exit listener failed', { id: this.id, error });
      }
    }
  }

  private sendSizeIfStarted() {
    if (!this.ptyStarted || this.disposed) return;
    this.queuePtyResize(this.terminal.cols, this.terminal.rows, true);
  }
}

import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ensureTerminalHost } from './terminalHost';
import { TerminalMetrics } from './TerminalMetrics';
import { log } from '../lib/logger';
import { TERMINAL_SNAPSHOT_VERSION, type TerminalSnapshotPayload } from '#types/terminalSnapshot';
import { pendingInjectionManager } from '../lib/PendingInjectionManager';
import { getProvider, type ProviderId } from '@shared/providers/registry';

const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_DATA_WINDOW_BYTES = 128 * 1024 * 1024; // 128 MB soft guardrail
// Ctrl+J sends line feed (LF) to the PTY, which CLI agents interpret as a newline
const CTRL_J_ASCII = '\x0A';

// Store viewport positions per terminal ID to preserve scroll position across detach/attach cycles
const viewportPositions = new Map<string, number>();

export interface SessionTheme {
  base: 'dark' | 'light';
  override?: ITerminalOptions['theme'];
}

export interface TerminalSessionOptions {
  taskId: string;
  cwd?: string;
  providerId?: string; // If set, uses direct CLI spawn
  shell?: string; // Used for shell-based spawn when providerId not set
  env?: Record<string, string>;
  initialSize: { cols: number; rows: number };
  scrollbackLines: number;
  theme: SessionTheme;
  telemetry?: { track: (event: string, payload?: Record<string, unknown>) => void } | null;
  autoApprove?: boolean;
  initialPrompt?: string;
  disableSnapshots?: boolean;
  onLinkClick?: (url: string) => void;
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

    // Map Shift+Enter to Ctrl+J for CLI agents
    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (this.shouldMapShiftEnterToCtrlJ(event)) {
        if (!this.disposed) {
          // Send Ctrl+J (line feed) instead of Shift+Enter
          window.electronAPI.ptyInput({ id: this.id, data: CTRL_J_ASCII });
        }
        return false; // Prevent xterm from processing the Shift+Enter
      }
      return true; // Let xterm handle all other keys normally
    });

    this.metrics = new TerminalMetrics({
      maxDataWindowBytes: MAX_DATA_WINDOW_BYTES,
      telemetry: options.telemetry ?? null,
    });

    const inputDisposable = this.terminal.onData((data) => {
      this.emitActivity();
      if (!this.disposed) {
        // Filter out focus reporting sequences (CSI I = focus in, CSI O = focus out)
        // These are sent by xterm.js when focus changes but shouldn't go to the PTY
        const filtered = data.replace(/\x1b\[I|\x1b\[O/g, '');
        if (filtered) {
          // Track command execution when Enter is pressed
          const isEnterPress = filtered.includes('\r') || filtered.includes('\n');
          if (isEnterPress) {
            void (async () => {
              const { captureTelemetry } = await import('../lib/telemetryClient');
              captureTelemetry('terminal_command_executed');
            })();
          }

          // Check for pending injection text when Enter is pressed
          const pendingText = pendingInjectionManager.getPending();
          if (pendingText && isEnterPress) {
            // Append pending text to the existing input and keep the prior working behavior.
            const stripped = filtered.replace(/[\r\n]+$/g, '');
            const injectedData = stripped + pendingText + '\r\r';
            window.electronAPI.ptyInput({ id: this.id, data: injectedData });
            pendingInjectionManager.markUsed();
          } else {
            window.electronAPI.ptyInput({ id: this.id, data: filtered });
          }
        }
      }
    });
    const resizeDisposable = this.terminal.onResize(({ cols, rows }) => {
      if (!this.disposed) {
        window.electronAPI.ptyResize({ id: this.id, cols, rows });
      }
    });
    this.disposables.push(
      () => inputDisposable.dispose(),
      () => resizeDisposable.dispose()
    );

    void this.initializeTerminal();
    // Only start snapshot timer if snapshots are enabled (main chats only)
    if (!this.options.disableSnapshots) {
      this.startSnapshotTimer();
    }
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
    }

    this.fitPreservingViewport();
    this.sendSizeIfStarted();

    this.resizeObserver = new ResizeObserver(() => {
      this.fitPreservingViewport();
    });
    this.resizeObserver.observe(container);

    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.fitPreservingViewport();
      this.sendSizeIfStarted();
      // Restore viewport position after fit completes and terminal is fully rendered
      // Use a second requestAnimationFrame to ensure the terminal buffer is ready
      requestAnimationFrame(() => {
        if (!this.disposed) {
          this.restoreViewportPosition();
        }
      });
    });
  }

  detach() {
    if (this.attachedContainer) {
      // Capture viewport position before detaching
      this.captureViewportPosition();
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      ensureTerminalHost().appendChild(this.container);
      this.attachedContainer = null;
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
        log.warn('Terminal session dispose callback failed', { id: this.id, error });
      }
    }
    this.metrics.dispose();
    this.activityListeners.clear();
    this.readyListeners.clear();
    this.errorListeners.clear();
    this.exitListeners.clear();
    this.terminal.dispose();
  }

  focus() {
    // Simply focus the xterm terminal - let React handle DOM management
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

  private shouldMapShiftEnterToCtrlJ(event: KeyboardEvent): boolean {
    return (
      event.type === 'keydown' &&
      event.key === 'Enter' &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    );
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
    if (fontFamily) {
      this.terminal.options.fontFamily = fontFamily;
    }
    if (fontSize) {
      this.terminal.options.fontSize = fontSize;
    }
  }

  /**
   * Fit the terminal to its container while preserving the user's viewport
   * position (prevents jumps when sidebars resize and trigger fits).
   */
  private fitPreservingViewport() {
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
            log.warn('Terminal scroll restore failed after fit', { id: this.id, error });
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
            cols: initialSize.cols,
            rows: initialSize.rows,
            autoApprove,
            initialPrompt,
            resume: hasExistingSession,
          })
        : window.electronAPI.ptyStart({
            id,
            cwd,
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
      this.sendSizeIfStarted();
      this.emitReady();
      try {
        const offStarted = window.electronAPI.onPtyStarted?.((payload: { id: string }) => {
          if (payload?.id === id) {
            this.ptyStarted = true;
            this.sendSizeIfStarted();
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

      this.terminal.write(chunk);
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
          log.warn('Terminal snapshot save failed', { id: this.id, error: result?.error });
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
    try {
      window.electronAPI.ptyResize({
        id: this.id,
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      });
    } catch (error) {
      log.warn('Terminal resize sync failed', { id: this.id, error });
    }
  }
}

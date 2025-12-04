import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';
import { ensureTerminalHost } from './terminalHost';
import { TerminalMetrics } from './TerminalMetrics';
import { log } from '../lib/logger';
import { TERMINAL_SNAPSHOT_VERSION, type TerminalSnapshotPayload } from '#types/terminalSnapshot';

const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_DATA_WINDOW_BYTES = 128 * 1024 * 1024; // 128 MB soft guardrail

export interface SessionTheme {
  base: 'dark' | 'light';
  override?: ITerminalOptions['theme'];
}

export interface TerminalSessionOptions {
  workspaceId: string;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  initialSize: { cols: number; rows: number };
  scrollbackLines: number;
  theme: SessionTheme;
  telemetry?: { track: (event: string, payload?: Record<string, unknown>) => void } | null;
  autoApprove?: boolean;
}

type CleanupFn = () => void;

export class TerminalSessionManager {
  readonly id: string;
  private readonly terminal: Terminal;
  private readonly fitAddon: FitAddon;
  private readonly serializeAddon: SerializeAddon;
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

  constructor(private readonly options: TerminalSessionOptions) {
    this.id = options.workspaceId;

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
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      allowProposedApi: true,
      scrollOnUserInput: false,
    });

    this.fitAddon = new FitAddon();
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.serializeAddon);
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

    this.metrics = new TerminalMetrics({
      maxDataWindowBytes: MAX_DATA_WINDOW_BYTES,
      telemetry: options.telemetry ?? null,
    });

    const inputDisposable = this.terminal.onData((data) => {
      this.emitActivity();
      if (!this.disposed) {
        window.electronAPI.ptyInput({ id: this.id, data });
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

    void this.restoreSnapshot().finally(() => this.connectPty());
    this.startSnapshotTimer();
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

    this.fitAddon.fit();
    this.terminal.focus();
    this.sendSizeIfStarted();

    this.resizeObserver = new ResizeObserver(() => {
      try {
        this.fitAddon.fit();
      } catch (error) {
        log.warn('Terminal fit failed', { id: this.id, error });
      }
    });
    this.resizeObserver.observe(container);

    requestAnimationFrame(() => {
      if (this.disposed) return;
      try {
        this.fitAddon.fit();
        this.sendSizeIfStarted();
      } catch (error) {
        log.warn('Terminal fit failed', { id: this.id, error });
      }
    });
  }

  detach() {
    if (this.attachedContainer) {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      ensureTerminalHost().appendChild(this.container);
      this.attachedContainer = null;
      void this.captureSnapshot('detach');
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
    void this.captureSnapshot('dispose');
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
    this.container.focus();
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

  private applyTheme(theme: SessionTheme) {
    const base =
      theme.base === 'light'
        ? {
            background: '#ffffff',
            foreground: '#1f2933',
            cursor: '#1f2933',
          }
        : {
            background: '#1f2937',
            foreground: '#f9fafb',
            cursor: '#f9fafb',
          };
    this.terminal.options.theme = { ...base, ...(theme.override ?? {}) };
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

  private connectPty() {
    const { workspaceId, cwd, shell, env, initialSize, autoApprove } = this.options;
    const id = workspaceId;
    void window.electronAPI
      .ptyStart({
        id,
        cwd,
        shell,
        env,
        cols: initialSize.cols,
        rows: initialSize.rows,
        autoApprove,
      })
      .then((result) => {
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
      })
      .catch((error: any) => {
        const message = error?.message || String(error);
        log.error('terminalSession:ptyStartError', { id, error });
        this.emitError(message);
      });

    const offData = window.electronAPI.onPtyData(id, (chunk) => {
      if (!this.metrics.canAccept(chunk)) {
        log.warn('Terminal scrollback truncated to protect memory', { id });
        this.terminal.clear();
        this.terminal.writeln('[scrollback truncated to protect memory]');
      }
      this.terminal.write(chunk);
      if (!this.firstFrameRendered) {
        this.firstFrameRendered = true;
        try {
          this.terminal.refresh(0, this.terminal.rows - 1);
        } catch {}
      }
    });

    const offExit = window.electronAPI.onPtyExit(id, (info) => {
      this.metrics.recordExit(info);
      this.ptyStarted = false;
      this.emitExit(info);
    });

    this.disposables.push(offData, offExit);
  }

  private async restoreSnapshot(): Promise<void> {
    if (!window.electronAPI.ptyGetSnapshot) return;
    try {
      const response = await window.electronAPI.ptyGetSnapshot({ id: this.id });
      if (!response?.ok || !response.snapshot?.data) return;

      const snapshot = response.snapshot as TerminalSnapshotPayload & {
        cols?: number;
        rows?: number;
      };

      if (snapshot.version && snapshot.version !== TERMINAL_SNAPSHOT_VERSION) {
        log.warn('terminalSession:snapshotIgnoredVersion', {
          id: this.id,
          version: snapshot.version,
        });
        return;
      }

      if (typeof snapshot.data === 'string' && snapshot.data.length > 0) {
        this.terminal.reset();
        this.terminal.write(snapshot.data);
      }
      if (snapshot.cols && snapshot.rows) {
        this.terminal.resize(snapshot.cols, snapshot.rows);
      }
    } catch (error) {
      log.warn('terminalSession:snapshotRestoreFailed', {
        id: this.id,
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  private captureSnapshot(reason: 'interval' | 'detach' | 'dispose'): Promise<void> {
    if (!window.electronAPI.ptySaveSnapshot) return Promise.resolve();
    if (this.disposed) return Promise.resolve();
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

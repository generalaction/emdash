type MetricsSnapshot = {
  totalBytes: number;
  overflowEvents: number;
  lastOverflowAt?: string;
};

interface TerminalMetricsOptions {
  maxDataWindowBytes: number;
  telemetry?: { track: (event: string, data?: Record<string, unknown>) => void } | null;
}

export class TerminalMetrics {
  private readonly maxWindowBytes: number;
  private readonly telemetry: TerminalMetricsOptions['telemetry'];
  private windowBytes = 0;
  private totalBytes = 0;
  private overflowEvents = 0;
  private lastOverflowAt: Date | null = null;

  constructor(options: TerminalMetricsOptions) {
    this.maxWindowBytes = options.maxDataWindowBytes;
    this.telemetry = options.telemetry ?? null;
  }

  canAccept(chunk: string): boolean {
    let bytes: number;
    if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
      bytes = Buffer.byteLength(chunk, 'utf8');
    } else {
      bytes = new TextEncoder().encode(chunk).length;
    }
    this.totalBytes += bytes;
    this.windowBytes += bytes;
    if (this.windowBytes <= this.maxWindowBytes) {
      return true;
    }

    this.overflowEvents += 1;
    this.lastOverflowAt = new Date();
    this.telemetry?.track('terminal_overflow', {
      bytes,
      windowBytes: this.windowBytes,
      maxWindowBytes: this.maxWindowBytes,
    });
    this.windowBytes = bytes; // reset window to current chunk
    return false;
  }

  snapshot(): MetricsSnapshot {
    return {
      totalBytes: this.totalBytes,
      overflowEvents: this.overflowEvents,
      lastOverflowAt: this.lastOverflowAt?.toISOString(),
    };
  }

  markSnapshot() {
    this.windowBytes = 0;
  }

  recordExit(info: { exitCode: number | undefined; signal?: number }) {
    this.telemetry?.track('terminal_exit', {
      exitCode: info.exitCode ?? null,
      signal: info.signal ?? null,
      totalBytes: this.totalBytes,
    });
  }

  dispose() {
    this.windowBytes = 0;
  }
}

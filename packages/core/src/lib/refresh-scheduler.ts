export interface RefreshSchedulerOptions {
  refresh: () => Promise<void>;
  debounceMs?: number;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export class RefreshScheduler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly options: RefreshSchedulerOptions) {
    if (options.intervalMs !== undefined) {
      this.intervalTimer = setInterval(() => this.invalidate(), options.intervalMs);
      this.intervalTimer.unref?.();
    }
  }

  invalidate(): void {
    if (this.disposed) return;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.trigger();
    }, this.options.debounceMs ?? 0);
    this.debounceTimer.unref?.();
  }

  refreshNow(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    return this.trigger();
  }

  private trigger(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.inFlight === null) {
      this.inFlight = this.run();
      return this.inFlight;
    }
    if (this.queued === null) {
      this.queued = this.inFlight.then(() => {
        this.queued = null;
        return this.trigger();
      });
    }
    return this.queued;
  }

  private async run(): Promise<void> {
    try {
      await this.options.refresh();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.inFlight = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    if (this.intervalTimer !== null) clearInterval(this.intervalTimer);
    this.debounceTimer = null;
  }
}

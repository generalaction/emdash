import type { IDisposable } from '@emdash/shared';

export type LiveSchedulerRun<R> = {
  result: R;
  completed: boolean;
};

export type LiveSchedulerOptions<R> = {
  run: () => Promise<LiveSchedulerRun<R>>;
  hasDemand: () => boolean;
  initialDirty?: boolean;
  debounceMs?: number;
  revalidateIntervalMs?: number;
  onBackgroundResult?: (result: R) => void;
};

export class LiveScheduler<R> implements IDisposable {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private inFlight: Promise<R> | null = null;
  private inFlightToken: object | null = null;
  private queued: Promise<R> | null = null;
  private revalidateTimer: ReturnType<typeof setTimeout> | null = null;
  private isDirty: boolean;

  constructor(private readonly options: LiveSchedulerOptions<R>) {
    this.isDirty = options.initialDirty ?? true;
  }

  get dirty(): boolean {
    return this.isDirty;
  }

  markDirty(): void {
    if (this.disposed) return;
    this.isDirty = true;
    if (!this.options.hasDemand()) return;
    this.scheduleDebounced();
  }

  markClean(): void {
    this.isDirty = false;
  }

  onDemandAvailable(): void {
    if (this.isDirty) {
      this.scheduleBackground();
    } else {
      this.armRevalidate();
    }
  }

  onDemandUnavailable(): void {
    if (!this.options.hasDemand()) this.clearTimers();
  }

  runDirect(): Promise<R> {
    return this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
  }

  private schedule(): Promise<R> {
    if (this.inFlight) {
      this.queued ??= this.inFlight.then(
        () => this.runNow(),
        () => this.runNow()
      );
      return this.queued;
    }
    return this.runNow();
  }

  private runNow(): Promise<R> {
    this.queued = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const token = {};
    this.inFlightToken = token;
    const run = (async () => {
      this.isDirty = false;
      let completed = false;
      try {
        const outcome = await this.options.run();
        completed = outcome.completed;
        if (!completed) this.isDirty = true;
        return outcome.result;
      } catch (error) {
        this.isDirty = true;
        throw error;
      } finally {
        if (this.inFlightToken === token) {
          this.inFlightToken = null;
          this.inFlight = null;
        }
        this.armRevalidate();
        if (completed && this.isDirty && !this.queued && this.options.hasDemand()) {
          this.scheduleDebounced();
        }
      }
    })();
    this.inFlight = run;
    return run;
  }

  private scheduleDebounced(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.isDirty || this.disposed) return;
      this.scheduleBackground();
    }, this.options.debounceMs ?? 0);
  }

  private scheduleBackground(): void {
    void this.schedule()
      .then((result) => this.options.onBackgroundResult?.(result))
      .catch((error) => {
        queueMicrotask(() => {
          throw error;
        });
      });
  }

  private armRevalidate(): void {
    const interval = this.options.revalidateIntervalMs;
    if (!interval || this.disposed || !this.options.hasDemand()) return;
    if (this.revalidateTimer) clearTimeout(this.revalidateTimer);
    this.revalidateTimer = setTimeout(() => {
      this.revalidateTimer = null;
      if (this.disposed || !this.options.hasDemand()) return;
      this.scheduleBackground();
    }, interval);
  }

  private clearTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.revalidateTimer) clearTimeout(this.revalidateTimer);
    this.revalidateTimer = null;
  }
}

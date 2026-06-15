import type { LiveValue, Unsubscribe } from '@emdash/shared/lib';
import { makeObservable, observable, runInAction } from 'mobx';
import type { ModelMirror } from './model-mirror';

export type MirrorBindingStatus =
  /** Not started yet. */
  | 'idle'
  /** Started, but the mirror has not been hydrated since (re)starting. */
  | 'syncing'
  /** Subscription active and the mirror holds a value. */
  | 'live'
  /** Repeated snapshot failures; retries continue in the background. */
  | 'error';

export type MirrorBinding = {
  readonly status: MirrorBindingStatus;
  start(): void;
  resync(): Promise<void>;
  dispose(): void;
};

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const ERROR_AFTER_FAILURES = 3;

export type BindMirrorOptions<T> = {
  mirror: ModelMirror<T>;
  subscribe: (push: (value: LiveValue<T>) => void) => Unsubscribe;
  snapshot: () => Promise<LiveValue<T>>;
  onError?: (error: unknown) => void;
};

class MirrorBindingImpl<T> implements MirrorBinding {
  status: MirrorBindingStatus = 'idle';

  private started = false;
  private unsubscribe: Unsubscribe | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private inFlight: Promise<void> | null = null;
  private runId = 0;

  constructor(private readonly opts: BindMirrorOptions<T>) {
    makeObservable(this, { status: observable });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.runId += 1;
    const runId = this.runId;
    this.setStatus('syncing');
    this.unsubscribe = this.opts.subscribe((value) => {
      if (!this.started || runId !== this.runId) return;
      this.opts.mirror.applyUpdate(value);
      if (this.opts.mirror.current) this.markLive();
    });
    void this.resync();
  }

  resync(): Promise<void> {
    if (!this.started) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.clearRetry();
    this.inFlight = this.loadSnapshot(this.runId);
    return this.inFlight;
  }

  dispose(): void {
    this.runId += 1;
    this.clearRetry();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.inFlight = null;
    this.started = false;
    this.failures = 0;
    this.setStatus('idle');
  }

  private async loadSnapshot(runId: number): Promise<void> {
    try {
      const value = await this.opts.snapshot();
      if (runId !== this.runId || !this.started) return;
      this.opts.mirror.setSnapshot(value);
      this.markLive();
    } catch (error) {
      if (runId !== this.runId || !this.started) return;
      this.failures += 1;
      if (this.failures >= ERROR_AFTER_FAILURES) this.setStatus('error');
      this.opts.onError?.(error);
      this.scheduleRetry();
    } finally {
      if (runId === this.runId) this.inFlight = null;
    }
  }

  private markLive(): void {
    this.failures = 0;
    this.clearRetry();
    this.setStatus('live');
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.failures - 1, RETRY_DELAYS_MS.length - 1)];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.resync();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private setStatus(status: MirrorBindingStatus): void {
    if (this.status === status) return;
    runInAction(() => {
      this.status = status;
    });
  }
}

export function bindMirror<T>(opts: BindMirrorOptions<T>): MirrorBinding {
  return new MirrorBindingImpl(opts);
}

import fs from 'node:fs/promises';
import parcelWatcher from '@parcel/watcher';
import type { IDisposable } from '../lib';
import type { RawFileEvent } from './types';

const RESUBSCRIBE_DELAY_MS = 250;
const MAX_RESUBSCRIBE_DELAY_MS = 30_000;

/**
 * One native subscription per (root, ignore set), shared across consumers.
 * Owns the resubscribe-with-retry reliability logic; after a successful resubscribe it
 * signals resync (events may have been lost in the gap).
 */
export class NativeWatch implements IDisposable {
  readonly root: string;
  readonly ignore: string[];
  private readonly deliver: (events: RawFileEvent[]) => void;
  private readonly resync: () => void;
  private readonly onError: (context: string, error: unknown) => void;
  private subscription: Promise<parcelWatcher.AsyncSubscription> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempts = 0;
  private disposed = false;

  constructor(
    root: string,
    ignore: string[],
    deliver: (events: RawFileEvent[]) => void,
    resync: () => void,
    onError: (context: string, error: unknown) => void
  ) {
    this.root = root;
    this.ignore = ignore;
    this.deliver = deliver;
    this.resync = resync;
    this.onError = onError;
    this.subscription = this.subscribe();
    this.subscription.catch(() => {});
  }

  async ready(): Promise<void> {
    if (!this.subscription) throw new Error(`Watcher is not subscribed for ${this.root}`);
    await this.subscription;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const subscription = await this.subscription?.catch(() => null);
    await subscription?.unsubscribe();
  }

  private async subscribe(): Promise<parcelWatcher.AsyncSubscription> {
    await fs.stat(this.root);
    return parcelWatcher.subscribe(
      this.root,
      (err, events) => {
        if (err) {
          this.onError(`watch ${this.root}`, err);
          this.scheduleResubscribe();
          return;
        }
        if (events.length === 0) return;
        this.deliver(events.map(toRawFileEvent));
      },
      { ignore: this.ignore }
    );
  }

  private scheduleResubscribe(): void {
    if (this.retryTimer || this.disposed) return;
    const delay = Math.min(RESUBSCRIBE_DELAY_MS * 2 ** this.retryAttempts, MAX_RESUBSCRIBE_DELAY_MS);
    this.retryAttempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed) return;
      const previous = this.subscription;
      this.subscription = this.subscribe();
      this.subscription.then(
        () => {
          this.retryAttempts = 0;
          this.resync();
        },
        (error) => {
          this.onError(`resubscribe ${this.root}`, error);
          this.scheduleResubscribe();
        }
      );
      void previous?.then((subscription) => subscription.unsubscribe()).catch(() => {});
    }, delay);
  }
}

function toRawFileEvent(event: parcelWatcher.Event): RawFileEvent {
  return {
    kind: event.type,
    path: event.path,
  };
}
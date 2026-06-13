import type { LiveValue } from '@emdash/shared/lib';
import { makeObservable, observable, runInAction } from 'mobx';

type Waiter = {
  seq: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export class ModelMirror<T> {
  current: LiveValue<T> | null = null;
  private waiters: Waiter[] = [];

  constructor() {
    makeObservable<this, 'current'>(this, {
      current: observable.ref,
    });
  }

  get value(): T | null {
    return this.current?.value ?? null;
  }

  get seq(): number {
    return this.current?.seq ?? -1;
  }

  setSnapshot(value: LiveValue<T>): void {
    this.apply(value);
  }

  applyUpdate(value: LiveValue<T>): void {
    this.apply(value);
  }

  waitForSeq(target: number, timeoutMs = 15_000): Promise<void> {
    if (this.seq >= target) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        seq: target,
        resolve,
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
                reject(new Error(`Timed out waiting for live model seq ${target}`));
              }, timeoutMs)
            : undefined,
      };
      this.waiters.push(waiter);
    });
  }

  dispose(): void {
    for (const waiter of this.waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error('ModelMirror disposed'));
    }
    this.waiters = [];
  }

  private apply(value: LiveValue<T>): void {
    if (value.seq <= this.seq) return;
    runInAction(() => {
      this.current = value;
    });
    this.flushWaiters();
  }

  private flushWaiters(): void {
    const ready = this.waiters.filter((waiter) => this.seq >= waiter.seq);
    if (ready.length === 0) return;
    this.waiters = this.waiters.filter((waiter) => this.seq < waiter.seq);
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }
}

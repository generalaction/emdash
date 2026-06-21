import type { LiveValue } from '@emdash/core/lib';
import { makeObservable, observable, runInAction } from 'mobx';

type Waiter = {
  sequence: number;
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

  get sequence(): number {
    return this.current?.sequence ?? -1;
  }

  get generation(): number {
    return this.current?.generation ?? -1;
  }

  setSnapshot(value: LiveValue<T>): void {
    this.apply(value);
  }

  applyUpdate(value: LiveValue<T>): void {
    this.apply(value);
  }

  waitForSequence(target: number, timeoutMs = 15_000): Promise<void> {
    if (this.sequence >= target) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        sequence: target,
        resolve,
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
                reject(new Error(`Timed out waiting for live model sequence ${target}`));
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
    if (this.current) {
      if (value.generation < this.current.generation) return;
      if (value.generation === this.current.generation && value.sequence <= this.current.sequence) {
        return;
      }
    }
    const generationChanged = this.current !== null && value.generation > this.current.generation;
    runInAction(() => {
      this.current = value;
    });
    if (generationChanged) {
      this.flushAllWaiters();
    } else {
      this.flushCaughtUpWaiters();
    }
  }

  private flushCaughtUpWaiters(): void {
    const ready = this.waiters.filter((waiter) => this.sequence >= waiter.sequence);
    if (ready.length === 0) return;
    this.waiters = this.waiters.filter((waiter) => this.sequence < waiter.sequence);
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private flushAllWaiters(): void {
    const ready = this.waiters;
    this.waiters = [];
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }
}

import { makeObservable, observable } from 'mobx';

type Waiter = {
  sequence: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export class MirrorVersion {
  sequence = -1;
  generation = -1;
  private waiters: Waiter[] = [];

  constructor(
    private readonly waitLabel: 'live model',
    private readonly disposedLabel: 'ModelMirror'
  ) {
    makeObservable<this, 'sequence' | 'generation'>(this, {
      sequence: observable,
      generation: observable,
    });
  }

  get hasBaseline(): boolean {
    return this.generation >= 0;
  }

  shouldApply(generation: number, sequence: number): boolean {
    if (generation < this.generation) return false;
    if (generation === this.generation && sequence <= this.sequence) return false;
    return true;
  }

  willChangeGeneration(generation: number): boolean {
    return this.hasBaseline && generation > this.generation;
  }

  accept(generation: number, sequence: number): void {
    this.generation = generation;
    this.sequence = sequence;
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
                reject(new Error(`Timed out waiting for ${this.waitLabel} sequence ${target}`));
              }, timeoutMs)
            : undefined,
      };
      this.waiters.push(waiter);
    });
  }

  flushAfterApply(generationChanged: boolean): void {
    if (generationChanged) {
      this.flushAllWaiters();
      return;
    }
    this.flushCaughtUpWaiters();
  }

  dispose(): void {
    for (const waiter of this.waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error(`${this.disposedLabel} disposed`));
    }
    this.waiters = [];
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

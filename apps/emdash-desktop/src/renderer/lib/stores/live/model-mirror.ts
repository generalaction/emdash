import type { LiveValue } from '@emdash/core/lib';
import { makeObservable, observable, runInAction } from 'mobx';
import { MirrorVersion } from './mirror-version';

export class ModelMirror<T> {
  current: LiveValue<T> | null = null;
  private readonly version = new MirrorVersion('live model', 'ModelMirror');

  constructor() {
    makeObservable<this, 'current'>(this, {
      current: observable.ref,
    });
  }

  get value(): T | null {
    return this.current?.value ?? null;
  }

  get hasSnapshot(): boolean {
    return this.current !== null;
  }

  get sequence(): number {
    return this.version.sequence;
  }

  get generation(): number {
    return this.version.generation;
  }

  setSnapshot(value: LiveValue<T>): void {
    this.apply(value);
  }

  applyUpdate(value: LiveValue<T>): void {
    this.apply(value);
  }

  waitForSequence(target: number, timeoutMs = 15_000): Promise<void> {
    return this.version.waitForSequence(target, timeoutMs);
  }

  dispose(): void {
    this.version.dispose();
  }

  private apply(value: LiveValue<T>): void {
    if (!this.version.shouldApply(value.generation, value.sequence)) return;
    const generationChanged = this.version.willChangeGeneration(value.generation);
    runInAction(() => {
      this.current = value;
      this.version.accept(value.generation, value.sequence);
    });
    this.version.flushAfterApply(generationChanged);
  }
}

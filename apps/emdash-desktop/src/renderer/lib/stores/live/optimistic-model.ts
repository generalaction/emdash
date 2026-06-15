import type { IDisposable } from '@emdash/shared/lib';
import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import type { Result } from '@shared/lib/result';
import type { ModelMirror } from './model-mirror';

type OptimisticUpdate<M> = {
  id: number;
  apply: (model: M) => M;
  dropGeneration?: number;
  dropAtSequence?: number;
  timer?: ReturnType<typeof setTimeout>;
};

export class OptimisticModel<M> implements IDisposable {
  private optimisticUpdates: OptimisticUpdate<M>[] = [];
  private nextId = 1;
  private readonly disposeReaction: () => void;

  constructor(private readonly mirror: ModelMirror<M>) {
    makeObservable<this, 'optimisticUpdates'>(this, {
      optimisticUpdates: observable.shallow,
      value: computed,
    });
    this.disposeReaction = reaction(
      () => [this.mirror.sequence, this.mirror.generation],
      () => this.dropCaughtUp()
    );
  }

  get value(): M | null {
    const value = this.mirror.value;
    if (value == null) return null;
    let next = value as M;
    for (const update of this.optimisticUpdates) {
      next = update.apply(next);
    }
    return next;
  }

  async run<Data, Error>(
    optimistic: ((model: M) => M) | null,
    call: () => Promise<Result<Data, Error>>,
    sequenceOf: (result: Data) => number | undefined
  ): Promise<Result<Data, Error>> {
    const update = optimistic ? this.add(optimistic) : null;
    const result = await call();
    if (!result.success) {
      if (update) this.remove(update.id);
      return result;
    }

    if (!update) return result;
    const sequence = sequenceOf(result.data);
    if (sequence === undefined) {
      this.remove(update.id);
      return result;
    }
    runInAction(() => {
      update.dropAtSequence = sequence;
      update.dropGeneration = this.mirror.generation;
      update.timer = setTimeout(() => this.remove(update.id), 15_000);
    });
    this.dropCaughtUp();
    return result;
  }

  dispose(): void {
    this.disposeReaction();
    for (const update of this.optimisticUpdates) {
      if (update.timer) clearTimeout(update.timer);
    }
    this.optimisticUpdates = [];
  }

  private add(apply: (model: M) => M): OptimisticUpdate<M> {
    const update: OptimisticUpdate<M> = { id: this.nextId++, apply };
    runInAction(() => {
      this.optimisticUpdates.push(update);
    });
    return update;
  }

  private remove(id: number): void {
    runInAction(() => {
      const update = this.optimisticUpdates.find((candidate) => candidate.id === id);
      if (update?.timer) clearTimeout(update.timer);
      this.optimisticUpdates = this.optimisticUpdates.filter((candidate) => candidate.id !== id);
    });
  }

  private dropCaughtUp(): void {
    for (const update of this.optimisticUpdates) {
      if (update.dropAtSequence === undefined) continue;
      const caughtUp = this.mirror.sequence >= update.dropAtSequence;
      const generationChanged =
        update.dropGeneration !== undefined && this.mirror.generation !== update.dropGeneration;
      if (caughtUp || generationChanged) {
        this.remove(update.id);
      }
    }
  }
}

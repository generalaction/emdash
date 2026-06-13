import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import type { Result } from '@shared/lib/result';
import type { ModelMirror } from './model-mirror';

type AnyResult<R> = Result<R, unknown>;

type Overlay<M> = {
  id: number;
  apply: (model: M) => M;
  dropAtSeq?: number;
  timer?: ReturnType<typeof setTimeout>;
};

export class OverlayStack<M> {
  private overlays: Overlay<M>[] = [];
  private nextId = 1;
  private readonly disposeReaction: () => void;

  constructor(private readonly mirror: ModelMirror<M>) {
    makeObservable<this, 'overlays'>(this, {
      overlays: observable.shallow,
      value: computed,
    });
    this.disposeReaction = reaction(
      () => this.mirror.seq,
      () => this.dropCaughtUp()
    );
  }

  get value(): M | null {
    const value = this.mirror.value;
    if (value == null) return null;
    let next = value as M;
    for (const overlay of this.overlays) {
      next = overlay.apply(next);
    }
    return next;
  }

  async run<R>(
    optimistic: ((model: M) => M) | null,
    call: () => Promise<AnyResult<R>>,
    seqOf: (result: R) => number | undefined
  ): Promise<AnyResult<R>> {
    const overlay = optimistic ? this.add(optimistic) : null;
    const result = await call();
    if (!result.success) {
      if (overlay) this.remove(overlay.id);
      return result;
    }

    if (!overlay) return result;
    const seq = seqOf(result.data);
    if (seq === undefined) {
      this.remove(overlay.id);
      return result;
    }
    runInAction(() => {
      overlay.dropAtSeq = seq;
      overlay.timer = setTimeout(() => this.remove(overlay.id), 15_000);
    });
    this.dropCaughtUp();
    return result;
  }

  dispose(): void {
    this.disposeReaction();
    for (const overlay of this.overlays) {
      if (overlay.timer) clearTimeout(overlay.timer);
    }
    this.overlays = [];
  }

  private add(apply: (model: M) => M): Overlay<M> {
    const overlay: Overlay<M> = { id: this.nextId++, apply };
    runInAction(() => {
      this.overlays.push(overlay);
    });
    return overlay;
  }

  private remove(id: number): void {
    runInAction(() => {
      const overlay = this.overlays.find((candidate) => candidate.id === id);
      if (overlay?.timer) clearTimeout(overlay.timer);
      this.overlays = this.overlays.filter((candidate) => candidate.id !== id);
    });
  }

  private dropCaughtUp(): void {
    for (const overlay of this.overlays) {
      if (overlay.dropAtSeq !== undefined && this.mirror.seq >= overlay.dropAtSeq) {
        this.remove(overlay.id);
      }
    }
  }
}

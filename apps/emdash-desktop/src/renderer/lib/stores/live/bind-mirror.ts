import type { LiveValue, Unsubscribe } from '@emdash/shared/lib';
import type { ModelMirror } from './model-mirror';

export type MirrorBinding = {
  start(): void;
  resync(): Promise<void>;
  dispose(): void;
};

export function bindMirror<T>(opts: {
  mirror: ModelMirror<T>;
  subscribe: (push: (value: LiveValue<T>) => void) => Unsubscribe;
  snapshot: () => Promise<LiveValue<T>>;
  onError?: (error: unknown) => void;
}): MirrorBinding {
  let unsubscribe: Unsubscribe | undefined;
  let started = false;

  const resync = async () => {
    try {
      opts.mirror.setSnapshot(await opts.snapshot());
    } catch (error) {
      opts.onError?.(error);
    }
  };

  return {
    start() {
      if (started) return;
      started = true;
      unsubscribe = opts.subscribe((value) => opts.mirror.applyUpdate(value));
      void resync();
    },
    resync,
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
      started = false;
    },
  };
}

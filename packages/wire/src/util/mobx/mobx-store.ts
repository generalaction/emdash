import { observable, runInAction } from 'mobx';
import type { StateStore } from '../../live/replica/store';
import { applyPatches } from '../../live/state/immer-setup';

export function createMobxStore<T>(): StateStore<T> {
  let ready = false;
  const value = observable.box<T | undefined>(undefined, { deep: false });

  return {
    reset(data) {
      runInAction(() => {
        ready = true;
        value.set(structuredClone(data));
      });
    },
    apply(patches) {
      const current = value.get();
      if (!ready) throw new Error('StateStore has not been seeded');
      const next = applyPatches(current as object, patches) as T;
      runInAction(() => value.set(next));
      return next;
    },
    current() {
      const current = value.get();
      if (!ready) throw new Error('StateStore has not been seeded');
      return current as T;
    },
  };
}

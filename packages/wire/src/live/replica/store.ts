import { applyPatches, type Patch } from '../model/immer-setup';

export interface StateStore<T> {
  reset(data: T): void;
  apply(patches: Patch[]): T;
  current(): T;
}

export function createPlainStore<T>(): StateStore<T> {
  let ready = false;
  let value: T | undefined;

  return {
    reset(data) {
      ready = true;
      value = structuredClone(data);
    },
    apply(patches) {
      if (!ready) throw new Error('StateStore has not been seeded');
      value = applyPatches(value as object, patches) as T;
      return value;
    },
    current() {
      if (!ready) throw new Error('StateStore has not been seeded');
      return value as T;
    },
  };
}

import { createScope, type Scope } from '@emdash/shared/concurrency';
import { systemClock, type Clock, type TimerHandle } from '@emdash/shared/scheduling';
import { stableStringify } from '@emdash/shared/util';

export type FamilyOptions<K> = {
  key?: (key: K) => string;
  lingerMs?: number;
  name?: string;
  scope?: Scope;
  clock?: Clock;
};

export type Family<K, R> = {
  (key: K): R;
  peekMember(key: K): R | undefined;
  retain(key: K): () => void;
  dispose(): Promise<void>;
};

type Entry<K, R> = {
  key: K;
  keyId: string;
  scope: Scope;
  value: R;
  retainCount: number;
  timer: TimerHandle | undefined;
};

export function family<K, R>(
  factory: (key: K, scope: Scope) => R,
  options: FamilyOptions<K> = {}
): Family<K, R> {
  const keyFor = options.key ?? stableStringify;
  const clock = options.clock ?? systemClock;
  const rootScope = options.scope ?? createScope({ label: options.name ?? 'state-family', clock });
  const entries = new Map<string, Entry<K, R>>();
  const lingerMs = options.lingerMs ?? 15_000;
  let disposed = false;

  const get = ((key: K): R => entryFor(key).value) as Family<K, R>;

  get.peekMember = (key) => entries.get(keyFor(key))?.value;
  get.retain = (key) => {
    const entry = entryFor(key);
    clearTimer(entry);
    entry.retainCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.retainCount = Math.max(0, entry.retainCount - 1);
      if (entry.retainCount === 0) scheduleDispose(entry);
    };
  };
  get.dispose = async () => {
    if (disposed) return;
    disposed = true;
    await rootScope.dispose();
    entries.clear();
  };

  rootScope.add(async () => {
    for (const entry of [...entries.values()]) {
      clearTimer(entry);
      await entry.scope.dispose();
    }
    entries.clear();
  });

  return get;

  function entryFor(key: K): Entry<K, R> {
    if (disposed || rootScope.disposed) throw new Error('State family is disposed');
    const keyId = keyFor(key);
    const existing = entries.get(keyId);
    if (existing) {
      if (existing.retainCount > 0) clearTimer(existing);
      else scheduleDispose(existing);
      return existing;
    }
    const scope = rootScope.child(keyId);
    const entry: Entry<K, R> = {
      key,
      keyId,
      scope,
      value: factory(key, scope),
      retainCount: 0,
      timer: undefined,
    };
    entries.set(keyId, entry);
    scheduleDispose(entry);
    return entry;
  }

  function scheduleDispose(entry: Entry<K, R>): void {
    if (entries.get(entry.keyId) !== entry || entry.retainCount > 0) return;
    clearTimer(entry);
    if (lingerMs <= 0) {
      void disposeEntry(entry);
      return;
    }
    entry.timer = clock.schedule(
      lingerMs,
      () => {
        entry.timer = undefined;
        void disposeEntry(entry);
      },
      { unref: true }
    );
  }

  async function disposeEntry(entry: Entry<K, R>): Promise<void> {
    if (entries.get(entry.keyId) !== entry) return;
    clearTimer(entry);
    entries.delete(entry.keyId);
    await entry.scope.dispose();
  }

  function clearTimer(entry: Entry<K, R>): void {
    entry.timer?.dispose();
    entry.timer = undefined;
  }
}

import { useSyncExternalStore } from 'react';
import { LiveLogClient, LiveModelClient } from '@emdash/core/live';
import type { LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '@emdash/core/live';
import type { z } from 'zod';

type Unsubscribe = () => void;

export interface LiveBinding<T> {
  start(): Promise<void>;
  dispose(): void;
  getSnapshot(): T | undefined;
  subscribe(cb: () => void): Unsubscribe;
}

export interface LiveLogBinding extends LiveBinding<LiveLogSnapshotData> {
  text(): string;
}

export function createLiveModelBinding<T>(options: {
  schema: z.ZodType<T>;
  snapshot: () => Promise<LiveSnapshot<T>>;
  subscribe: () => Promise<AsyncIterator<LiveUpdate>>;
}): LiveBinding<T> {
  const listeners = new Set<() => void>();
  let iterator: AsyncIterator<LiveUpdate> | null = null;
  let disposed = false;
  let value: T | undefined;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const client = new LiveModelClient<T>(options.schema, options.snapshot, (next) => {
    value = next;
    notify();
  });

  return {
    async start() {
      client.seed(await options.snapshot());
      iterator = await options.subscribe();
      void pump(iterator, (update) => client.applyUpdate(update), () => disposed);
    },
    dispose() {
      disposed = true;
      iterator?.return?.(undefined).catch(() => {});
      listeners.clear();
    },
    getSnapshot() {
      return value;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export function createLiveLogBinding(options: {
  snapshot: () => Promise<LiveSnapshot<LiveLogSnapshotData>>;
  subscribe: () => Promise<AsyncIterator<LiveUpdate>>;
}): LiveLogBinding {
  const listeners = new Set<() => void>();
  let iterator: AsyncIterator<LiveUpdate> | null = null;
  let disposed = false;
  let value: LiveLogSnapshotData | undefined;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const client = new LiveLogClient({
    refetchSnapshot: options.snapshot,
    onReset: (next) => {
      value = next;
      notify();
    },
    onAppend: (chunk) => {
      value = value ? { ...value, text: `${value.text}${chunk}` } : undefined;
      notify();
    },
  });

  return {
    async start() {
      client.seed(await options.snapshot());
      iterator = await options.subscribe();
      void pump(iterator, (update) => client.applyUpdate(update), () => disposed);
    },
    dispose() {
      disposed = true;
      iterator?.return?.(undefined).catch(() => {});
      listeners.clear();
    },
    getSnapshot() {
      return value;
    },
    text() {
      return value?.text ?? '';
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export function useLiveModel<T>(binding: LiveBinding<T>): T | undefined {
  return useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getSnapshot);
}

export function useLiveLog(binding: LiveLogBinding): LiveLogSnapshotData | undefined {
  return useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getSnapshot);
}

async function pump(
  iterator: AsyncIterator<LiveUpdate>,
  onUpdate: (update: LiveUpdate) => void,
  isDisposed: () => boolean
): Promise<void> {
  try {
    while (!isDisposed()) {
      const next = await iterator.next();
      if (next.done) return;
      onUpdate(next.value);
    }
  } catch {
    // The owning connection handles reconnect by replacing the binding.
  }
}

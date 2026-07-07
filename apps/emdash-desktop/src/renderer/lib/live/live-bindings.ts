import { LiveLogClient, LiveModelClient } from '@emdash/core/live';
import type { LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '@emdash/core/live';
import type { Unsubscribe } from '@emdash/shared';
import { useSyncExternalStore } from 'react';
import type { z } from 'zod';

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
  attach: (push: (update: LiveUpdate) => void) => Promise<Unsubscribe>;
}): LiveBinding<T> {
  const listeners = new Set<() => void>();
  let detach: Unsubscribe | null = null;
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
      let seeded = false;
      const buffer: LiveUpdate[] = [];
      detach = await options.attach((update) => {
        if (seeded) {
          client.applyUpdate(update);
        } else {
          buffer.push(update);
        }
      });
      if (disposed) {
        detach();
        detach = null;
        return;
      }
      client.seed(await options.snapshot());
      seeded = true;
      for (const update of buffer) {
        client.applyUpdate(update);
      }
    },
    dispose() {
      disposed = true;
      detach?.();
      detach = null;
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
  attach: (push: (update: LiveUpdate) => void) => Promise<Unsubscribe>;
}): LiveLogBinding {
  const listeners = new Set<() => void>();
  let detach: Unsubscribe | null = null;
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
      let seeded = false;
      const buffer: LiveUpdate[] = [];
      detach = await options.attach((update) => {
        if (seeded) {
          client.applyUpdate(update);
        } else {
          buffer.push(update);
        }
      });
      if (disposed) {
        detach();
        detach = null;
        return;
      }
      client.seed(await options.snapshot());
      seeded = true;
      for (const update of buffer) {
        client.applyUpdate(update);
      }
    },
    dispose() {
      disposed = true;
      detach?.();
      detach = null;
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

import type { Unsubscribe } from '@emdash/shared';
import type { LiveModelClient } from '../model';
import type { LiveModelData, LiveModelKey, LiveModelRef } from './model-ref';

type ClientEntry = {
  key: unknown;
  client: unknown;
};

export class LiveBindingRegistry {
  private readonly entries = new Map<string, Map<string, ClientEntry>>();

  register<Ref extends LiveModelRef>(
    ref: Ref,
    key: LiveModelKey<Ref>,
    client: LiveModelClient<LiveModelData<Ref>>
  ): Unsubscribe {
    const group = getOrCreate(this.entries, ref.id);
    const stableKey = stableStringify(key);
    group.set(stableKey, { key, client });
    return () => {
      if (group.get(stableKey)?.client === client) group.delete(stableKey);
      if (group.size === 0) this.entries.delete(ref.id);
    };
  }

  find(model: string, key: unknown): LiveModelClient<unknown> | undefined {
    return this.entries.get(model)?.get(stableStringify(key))?.client as
      | LiveModelClient<unknown>
      | undefined;
  }

  findByRef<Ref extends LiveModelRef>(
    ref: Ref,
    key: LiveModelKey<Ref>
  ): LiveModelClient<LiveModelData<Ref>> | undefined {
    return this.find(ref.id, key) as LiveModelClient<LiveModelData<Ref>> | undefined;
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function getOrCreate<K, V>(map: Map<K, Map<string, V>>, key: K): Map<string, V> {
  const existing = map.get(key);
  if (existing) return existing;
  const created = new Map<string, V>();
  map.set(key, created);
  return created;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

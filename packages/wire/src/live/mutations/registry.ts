import type { Unsubscribe } from '@emdash/shared';
import type { LiveModelClient, LiveModelServer } from '../model';
import type { LiveModelGroupInstance } from './group';
import type { LiveModelData, LiveModelKey, LiveModelRef } from './model-ref';

type ServerEntry = {
  key: unknown;
  server: unknown;
};

type ClientEntry = {
  key: unknown;
  client: unknown;
};

export class LiveModelRegistry {
  private readonly entries = new Map<string, Map<string, ServerEntry>>();

  register<Ref extends LiveModelRef>(
    ref: Ref,
    key: LiveModelKey<Ref>,
    server: LiveModelServer<LiveModelData<Ref>>
  ): Unsubscribe {
    const group = getOrCreate(this.entries, ref.id);
    const stableKey = stableStringify(key);
    group.set(stableKey, { key, server });
    return () => {
      if (group.get(stableKey)?.server === server) group.delete(stableKey);
      if (group.size === 0) this.entries.delete(ref.id);
    };
  }

  resolve<Ref extends LiveModelRef>(
    ref: Ref,
    key: LiveModelKey<Ref>
  ): LiveModelServer<LiveModelData<Ref>> | undefined {
    const entry = this.entries.get(ref.id)?.get(stableStringify(key));
    return entry?.server as LiveModelServer<LiveModelData<Ref>> | undefined;
  }

  instances<Ref extends LiveModelRef>(
    ref: Ref,
    partialKey: Partial<LiveModelKey<Ref>> = {}
  ): Array<[LiveModelKey<Ref>, LiveModelServer<LiveModelData<Ref>>]> {
    const group = this.entries.get(ref.id);
    if (!group) return [];
    const matches: Array<[LiveModelKey<Ref>, LiveModelServer<LiveModelData<Ref>>]> = [];
    for (const entry of group.values()) {
      if (!matchesPartial(entry.key, partialKey)) continue;
      matches.push([
        entry.key as LiveModelKey<Ref>,
        entry.server as LiveModelServer<LiveModelData<Ref>>,
      ]);
    }
    return matches;
  }

  registerGroup<Group extends { models: Record<string, LiveModelRef> }>(
    group: Group,
    key: unknown,
    instance: LiveModelGroupInstance
  ): Unsubscribe {
    const unsubscribes: Unsubscribe[] = [];
    for (const [name, ref] of Object.entries(group.models)) {
      const server = instance.models[name];
      if (!server) continue;
      unsubscribes.push(this.register(ref, key as never, server as LiveModelServer<never>));
    }
    return () => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    };
  }
}

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

function matchesPartial(candidate: unknown, partial: unknown): boolean {
  if (!isRecord(partial)) return stableStringify(candidate) === stableStringify(partial);
  if (!isRecord(candidate)) return false;
  for (const [key, expected] of Object.entries(partial)) {
    if (isRecord(expected)) {
      if (!matchesPartial(candidate[key], expected)) return false;
      continue;
    }
    if (stableStringify(candidate[key]) !== stableStringify(expected)) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

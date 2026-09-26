import { createScope } from '@emdash/shared/concurrency';
import { toast } from '@emdash/ui/react/primitives';
import { observe, remote, whenReady } from '@emdash/wire/state';
import { useSyncExternalStore } from 'react';
import { conversationsContract } from '../contract';
import {
  emptyProviderSettings,
  type ProviderSettingsKey,
  type ProviderSettingsSnapshot,
  type ProviderPreferencePatch,
} from '../provider-settings';
import { getConversationsClient } from './client';

type Pending = {
  key: ProviderSettingsKey;
  patch: ProviderPreferencePatch;
};
const stores = new Map<string, SettingsStore>();
const pending: Pending[] = [];
let writes = Promise.resolve();

function project(base: ProviderSettingsSnapshot, mutation: Pending): ProviderSettingsSnapshot {
  if (mutation.patch.transport === 'pty') {
    return {
      ...base,
      pty: { ...base.pty, autoApprove: mutation.patch.autoApprove },
    };
  }
  const options = { ...base.acp.options, ...mutation.patch.options };
  return { ...base, acp: { ...base.acp, options } };
}
class SettingsStore {
  private base = emptyProviderSettings;
  private value = { settings: emptyProviderSettings, ready: false };
  private listeners = new Set<() => void>();
  private readonly scope = createScope({ label: 'provider-preferences' });
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;
  private leases = 0;
  readonly ready: Promise<void>;
  constructor(readonly key: ProviderSettingsKey) {
    this.ready = this.connect();
    this.scheduleRelease();
    void this.ready.catch((error) =>
      toast.error('Could not load agent preferences', { description: String(error) })
    );
  }
  private async connect() {
    const client = (await getConversationsClient()).providerSettings;
    const scope = this.scope;
    const model = remote(conversationsContract.providerSettings.model, client.model, { scope });
    const state = model(this.key).states.value;
    observe(
      state,
      (snapshot) => {
        if (snapshot.value === undefined) return;
        this.base = snapshot.value;
        this.refresh(true);
      },
      { scope }
    );
    const settled = await whenReady(state, { scope });
    if (settled.value === undefined) throw new Error('Provider settings are unavailable');
  }
  subscribe = (listener: () => void) => {
    const release = this.retain();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      release();
    };
  };
  retain() {
    clearTimeout(this.releaseTimer);
    this.leases++;
    return () => {
      if (--this.leases === 0) this.scheduleRelease();
    };
  }
  private scheduleRelease() {
    this.releaseTimer = setTimeout(() => {
      stores.delete(storeKey(this.key));
      void this.scope.dispose();
    }, 30_000);
  }
  snapshot = () => this.value;
  refresh(ready = this.value.ready) {
    let settings = this.base;
    for (const mutation of pending)
      if (mutation.key.host === this.key.host && mutation.key.providerId === this.key.providerId)
        settings = project(settings, mutation);
    this.value = { settings, ready };
    for (const listener of this.listeners) listener();
  }
  accept(snapshot: ProviderSettingsSnapshot) {
    this.base = snapshot;
    this.refresh(true);
  }
}
function storeKey(key: ProviderSettingsKey) {
  return JSON.stringify([key.host, key.providerId]);
}
function store(key: ProviderSettingsKey) {
  const id = storeKey(key);
  let value = stores.get(id);
  if (!value) {
    value = new SettingsStore(key);
    stores.set(id, value);
  }
  return value;
}
const disabledSnapshot = { settings: emptyProviderSettings, ready: true };
const noSubscribe = () => () => {};
export function useProviderSettings(key: ProviderSettingsKey | null) {
  const source = key ? store(key) : null;
  return useSyncExternalStore(
    source?.subscribe ?? noSubscribe,
    source?.snapshot ?? (() => disabledSnapshot),
    () => disabledSnapshot
  );
}
function mutate(mutation: Pending): Promise<void> {
  pending.push(mutation);
  for (const source of stores.values()) source.refresh();
  const operation = writes
    .catch(() => {})
    .then(async () => {
      const client = (await getConversationsClient()).providerSettings;
      const snapshot = await client.patch({ ...mutation.key, patch: mutation.patch });
      store(mutation.key).accept(snapshot);
    })
    .finally(() => {
      pending.splice(pending.indexOf(mutation), 1);
      for (const source of stores.values()) source.refresh();
    });
  writes = operation;
  void operation.catch((error) => {
    if (writes === operation) writes = Promise.resolve();
    toast.error('Could not save agent preferences', { description: String(error) });
  });
  return operation;
}
export function patchProviderSettings(key: ProviderSettingsKey, patch: ProviderPreferencePatch) {
  return mutate({ key, patch });
}
export async function readProviderSettings(key: ProviderSettingsKey) {
  const source = store(key);
  const release = source.retain();
  try {
    await source.ready;
    await writes;
    return source.snapshot().settings;
  } finally {
    release();
  }
}

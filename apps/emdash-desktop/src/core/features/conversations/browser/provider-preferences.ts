import type { SerializedHostRef } from '@emdash/core/primitives/host/api';
import {
  providerPreferencesMemento,
  type ProviderPreference,
  type ProviderPreferencesState,
} from '@core/features/conversations/contributions/mementos';
import { getMementoClient, type MementoHandle } from '@core/primitives/mementos/browser';
import { appSubject } from '@core/primitives/subjects/api';

export type ConversationTransport = 'acp' | 'pty';
export type ProviderPreferencePatch = Partial<Record<keyof ProviderPreference, string | null>>;

let handle: MementoHandle<ProviderPreferencesState> | null = null;

export function providerPreferenceKey(
  host: SerializedHostRef,
  providerId: string,
  transport: ConversationTransport
): string {
  return JSON.stringify([host, providerId, transport]);
}

export function providerPreference(
  state: ProviderPreferencesState,
  host: SerializedHostRef,
  providerId: string,
  transport: ConversationTransport
): ProviderPreference {
  return state.entries[providerPreferenceKey(host, providerId, transport)] ?? {};
}

export function patchProviderPreference(
  state: ProviderPreferencesState,
  host: SerializedHostRef,
  providerId: string,
  transport: ConversationTransport,
  patch: ProviderPreferencePatch
): ProviderPreferencesState {
  const key = providerPreferenceKey(host, providerId, transport);
  const next = { ...(state.entries[key] ?? {}) };
  for (const [field, value] of Object.entries(patch) as Array<
    [keyof ProviderPreference, string | null]
  >) {
    if (value === null) delete next[field];
    else next[field] = value;
  }
  const entries = { ...state.entries };
  if (Object.keys(next).length === 0) delete entries[key];
  else entries[key] = next;
  return { ...state, entries };
}

export async function updateProviderPreference(
  host: SerializedHostRef,
  providerId: string,
  transport: ConversationTransport,
  patch: ProviderPreferencePatch
): Promise<void> {
  const preferences = preferencesHandle();
  await preferences.ready;
  preferences.update((current) =>
    patchProviderPreference(current, host, providerId, transport, patch)
  );
}

function preferencesHandle(): MementoHandle<ProviderPreferencesState> {
  if (handle) return handle;
  const space = getMementoClient().subject(appSubject({}));
  handle = space.handle(providerPreferencesMemento);
  return handle;
}

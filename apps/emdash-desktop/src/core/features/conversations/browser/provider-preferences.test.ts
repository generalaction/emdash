import { formatHostRef, hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { describe, expect, it } from 'vitest';
import type { ProviderPreferencesState } from '@core/features/conversations/contributions/mementos';
import {
  patchProviderPreference,
  providerPreference,
  providerPreferenceKey,
} from './provider-preferences';

describe('providerPreferenceKey', () => {
  it('isolates hosts, providers, and transports', () => {
    const local = formatHostRef(LOCAL_HOST_REF);
    const remote = formatHostRef(hostRef('remote', 'ssh-1'));
    expect(providerPreferenceKey(local, 'claude', 'acp')).not.toBe(
      providerPreferenceKey(local, 'claude', 'pty')
    );
    expect(providerPreferenceKey(local, 'claude', 'acp')).not.toBe(
      providerPreferenceKey(local, 'codex', 'acp')
    );
    expect(providerPreferenceKey(remote, 'claude', 'acp')).not.toBe(
      providerPreferenceKey(local, 'claude', 'acp')
    );
  });

  it('reads and patches one keyed preference without mutating the source document', () => {
    const local = formatHostRef(LOCAL_HOST_REF);
    const initial: ProviderPreferencesState = { version: '1', entries: {} };

    const updated = patchProviderPreference(initial, local, 'claude', 'acp', {
      model: 'sonnet',
      modeId: 'agent',
    });

    expect(initial.entries).toEqual({});
    expect(providerPreference(updated, local, 'claude', 'acp')).toEqual({
      model: 'sonnet',
      modeId: 'agent',
    });
    expect(providerPreference(updated, local, 'claude', 'pty')).toEqual({});
  });

  it('removes null fields and drops empty preference entries', () => {
    const local = formatHostRef(LOCAL_HOST_REF);
    const initial = patchProviderPreference({ version: '1', entries: {} }, local, 'claude', 'acp', {
      model: 'sonnet',
    });

    const updated = patchProviderPreference(initial, local, 'claude', 'acp', { model: null });

    expect(updated.entries).toEqual({});
  });
});

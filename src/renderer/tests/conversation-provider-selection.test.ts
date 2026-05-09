import { describe, expect, it } from 'vitest';
import { resolveConversationProviderSelection } from '@renderer/features/tasks/conversations/provider-selection';

describe('resolveConversationProviderSelection', () => {
  it('keeps default provider while availability is unknown', () => {
    const selection = resolveConversationProviderSelection({
      defaultProviderId: 'claude',
      providerOverride: null,
      installedProviderIds: [],
      availabilityKnown: false,
    });

    expect(selection.providerId).toBe('claude');
    expect(selection.createDisabled).toBe(false);
  });

  it('falls back to the first installed provider when default is unavailable', () => {
    const selection = resolveConversationProviderSelection({
      defaultProviderId: 'claude',
      providerOverride: null,
      installedProviderIds: ['codex', 'qwen'],
      availabilityKnown: true,
    });

    expect(selection.providerId).toBe('codex');
    expect(selection.createDisabled).toBe(false);
  });

  it('disables creation when no agents are installed', () => {
    const selection = resolveConversationProviderSelection({
      defaultProviderId: 'claude',
      providerOverride: null,
      installedProviderIds: [],
      availabilityKnown: true,
    });

    expect(selection.providerId).toBeNull();
    expect(selection.createDisabled).toBe(true);
  });

  it('honors an explicit provider override', () => {
    const selection = resolveConversationProviderSelection({
      defaultProviderId: 'claude',
      providerOverride: 'codex',
      installedProviderIds: ['codex'],
      availabilityKnown: true,
    });

    expect(selection.providerId).toBe('codex');
    expect(selection.createDisabled).toBe(false);
  });
});

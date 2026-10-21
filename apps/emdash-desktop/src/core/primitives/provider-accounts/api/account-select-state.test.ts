import { describe, expect, it } from 'vitest';
import { createRequiredProviderAccountSelectState } from './account-select-state';
import type { ProviderAccountSummary } from './provider-account-summary';

function account(
  accountId: string,
  overrides: Partial<ProviderAccountSummary> = {}
): ProviderAccountSummary {
  return {
    providerId: 'linear',
    displayName: accountId,
    accountId,
    isDefault: false,
    ...overrides,
  };
}

describe('required provider account selection', () => {
  it('sorts the default account first', () => {
    const first = account('linear:1');
    const defaultAccount = account('linear:2', { isDefault: true });

    expect(
      createRequiredProviderAccountSelectState(undefined, [first, defaultAccount]).accounts
    ).toEqual([defaultAccount, first]);
  });

  it('selects the requested account when it is available', () => {
    const first = account('linear:1');
    const selected = account('linear:2', { isDefault: true });

    const state = createRequiredProviderAccountSelectState('linear:1', [first, selected]);

    expect(state.selectedAccount).toBe(first);
    expect(state.selectedAccountId).toBe('linear:1');
  });

  it('falls back to the default account when the requested account is unavailable', () => {
    const first = account('linear:1');
    const defaultAccount = account('linear:2', { isDefault: true });

    const state = createRequiredProviderAccountSelectState('linear:missing', [
      first,
      defaultAccount,
    ]);

    expect(state.selectedAccount).toBe(defaultAccount);
    expect(state.selectedAccountId).toBe('linear:2');
  });

  it('has no selected account when there are no accounts', () => {
    const state = createRequiredProviderAccountSelectState(undefined, []);

    expect(state.selectedAccount).toBeNull();
    expect(state.selectedAccountId).toBeNull();
  });
});

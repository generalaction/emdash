import { describe, expect, it } from 'vitest';
import {
  sortProviderAccountsByDefault,
  type ProviderAccountSummary,
} from './provider-account-summary';

function account(overrides: Partial<ProviderAccountSummary>): ProviderAccountSummary {
  return { providerId: 'jira', accountId: 'a', displayName: 'a', isDefault: false, ...overrides };
}

describe('sortProviderAccountsByDefault', () => {
  it('sorts the default first, then by display name', () => {
    const sorted = sortProviderAccountsByDefault([
      account({ accountId: 'b', displayName: 'bravo' }),
      account({ accountId: 'd', displayName: 'delta', isDefault: true }),
      account({ accountId: 'a', displayName: 'alpha' }),
    ]);
    expect(sorted.map((entry) => entry.accountId)).toEqual(['d', 'a', 'b']);
  });

  it('does not mutate the input', () => {
    const input = [account({ accountId: 'b' }), account({ accountId: 'a', isDefault: true })];
    sortProviderAccountsByDefault(input);
    expect(input.map((entry) => entry.accountId)).toEqual(['b', 'a']);
  });
});

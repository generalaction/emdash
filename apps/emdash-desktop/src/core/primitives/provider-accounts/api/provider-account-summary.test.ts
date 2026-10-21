import { describe, expect, it } from 'vitest';
import {
  sortProviderAccountsByDefault,
  toProviderAccountSummary,
  type ProviderAccountSummary,
} from './provider-account-summary';

describe('toProviderAccountSummary', () => {
  it.each([
    [{}, 'Account 2'],
    [{ login: 'jona' }, '@jona'],
    [{ displayName: 'Jona', login: 'jona' }, 'Jona'],
    [{ label: 'Work', displayName: 'Jona', login: 'jona' }, 'Work'],
  ] as const)('prefers real display metadata over a generated name: %j', (meta, name) => {
    expect(
      toProviderAccountSummary({
        providerId: 'forgejo',
        accountId: 'codeberg.org:985170',
        isDefault: true,
        meta: { version: '1', fallbackDisplayName: 'Account 2', ...meta },
      }).displayName
    ).toBe(name);
  });

  it.each([null, { version: '1' as const }, { version: '1' as const, displayName: '  ' }])(
    'keeps internal identifiers out of labels when display metadata is missing',
    (meta) => {
      const summary = toProviderAccountSummary({
        providerId: 'forgejo',
        accountId: 'codeberg.org:985170',
        isDefault: true,
        meta,
      });
      expect(summary.displayName).toBe('Unnamed account');
      expect(summary.accountId).toBe('codeberg.org:985170');
    }
  );

  it('uses a login when labels are blank', () => {
    expect(
      toProviderAccountSummary({
        providerId: 'forgejo',
        accountId: 'codeberg.org:985170',
        isDefault: true,
        meta: { version: '1', label: ' ', displayName: '', login: 'jona' },
      }).displayName
    ).toBe('@jona');
  });
});

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

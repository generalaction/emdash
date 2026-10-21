import { describe, expect, it } from 'vitest';
import {
  resolveProviderAccount,
  resolveProviderAccountForHost,
  type ProviderAccountHostMatching,
} from './resolve-provider-account';

type TestAccount = {
  accountId: string;
  isDefault: boolean;
  host: string;
};

function account(overrides: Partial<TestAccount>): TestAccount {
  return { accountId: 'a1', isDefault: false, host: 'github.com', ...overrides };
}

const normalize = (host: string) => host.trim().toLowerCase();
const hostMatching = (host: string | null): ProviderAccountHostMatching<TestAccount> => ({
  host,
  hostOf: (candidate) => candidate.host,
  normalize,
});

describe('resolveProviderAccount without host matching (integrations)', () => {
  const defaultAccount = account({ accountId: 'default-acct', isDefault: true });
  const otherAccount = account({ accountId: 'other-acct' });

  it('explicit none is set null', () => {
    expect(resolveProviderAccount({ kind: 'none' }, [defaultAccount])).toEqual({
      value: null,
      provenance: { kind: 'set' },
    });
  });

  it('explicit pin resolves to that account', () => {
    expect(
      resolveProviderAccount({ kind: 'account', accountId: 'other-acct' }, [
        defaultAccount,
        otherAccount,
      ])
    ).toEqual({ value: otherAccount, provenance: { kind: 'set' } });
  });

  it('dangling pin fails closed, never another identity', () => {
    expect(
      resolveProviderAccount({ kind: 'account', accountId: 'gone' }, [defaultAccount])
    ).toEqual({ value: null, provenance: { kind: 'unresolvable' } });
  });

  it('absence infers the default account', () => {
    expect(resolveProviderAccount(undefined, [otherAccount, defaultAccount])).toEqual({
      value: defaultAccount,
      provenance: { kind: 'inferred', from: 'default account' },
    });
  });

  it('self-heals a missing default flag to the first account', () => {
    expect(resolveProviderAccount(undefined, [otherAccount])).toEqual({
      value: otherAccount,
      provenance: { kind: 'inferred', from: 'default account' },
    });
  });

  it('infers null with no accounts', () => {
    expect(resolveProviderAccount(undefined, [])).toEqual({
      value: null,
      provenance: { kind: 'inferred', from: 'default account' },
    });
  });
});

describe('resolveProviderAccount with host matching (GitHub semantics)', () => {
  const dotcomDefault = account({ accountId: 'dotcom', isDefault: true, host: 'github.com' });
  const ghes = account({ accountId: 'ghes', host: 'ghe.example.com' });

  it('explicit pin on a matching host resolves', () => {
    expect(
      resolveProviderAccount({ kind: 'account', accountId: 'ghes' }, [dotcomDefault, ghes], {
        ...hostMatching('ghe.example.com'),
      })
    ).toEqual({ value: ghes, provenance: { kind: 'set' } });
  });

  it('explicit pin on a mismatched host fails closed', () => {
    expect(
      resolveProviderAccount({ kind: 'account', accountId: 'ghes' }, [dotcomDefault, ghes], {
        ...hostMatching('github.com'),
      })
    ).toEqual({ value: null, provenance: { kind: 'unresolvable' } });
  });

  it('an unknown repository host is not mismatch evidence for a pin', () => {
    expect(
      resolveProviderAccount({ kind: 'account', accountId: 'ghes' }, [dotcomDefault, ghes], {
        ...hostMatching(null),
      })
    ).toEqual({ value: ghes, provenance: { kind: 'set' } });
  });

  it('dangling pin fails closed regardless of host', () => {
    expect(
      resolveProviderAccount({ kind: 'account', accountId: 'gone' }, [dotcomDefault], {
        ...hostMatching('github.com'),
      })
    ).toEqual({ value: null, provenance: { kind: 'unresolvable' } });
  });

  it('explicit none is set null regardless of host', () => {
    expect(
      resolveProviderAccount({ kind: 'none' }, [dotcomDefault], {
        ...hostMatching('github.com'),
      })
    ).toEqual({ value: null, provenance: { kind: 'set' } });
  });

  it('absence infers the default account when its host matches', () => {
    expect(
      resolveProviderAccount(undefined, [ghes, dotcomDefault], { ...hostMatching('github.com') })
    ).toEqual({
      value: dotcomDefault,
      provenance: { kind: 'inferred', from: 'default account' },
    });
  });

  it('absence infers the only host-matching account when the default mismatches', () => {
    expect(
      resolveProviderAccount(undefined, [dotcomDefault, ghes], {
        ...hostMatching('ghe.example.com'),
      })
    ).toEqual({
      value: ghes,
      provenance: { kind: 'inferred', from: 'only host-matching account' },
    });
  });

  it('absence infers nothing when several non-default accounts match the host', () => {
    const secondGhes = account({ accountId: 'ghes-2', host: 'ghe.example.com' });
    expect(
      resolveProviderAccount(undefined, [dotcomDefault, ghes, secondGhes], {
        ...hostMatching('ghe.example.com'),
      })
    ).toEqual({ value: null, provenance: { kind: 'inferred', from: 'no host-matching account' } });
  });

  it('absence infers nothing when the repository host is unknown', () => {
    expect(resolveProviderAccount(undefined, [dotcomDefault], { ...hostMatching(null) })).toEqual({
      value: null,
      provenance: { kind: 'inferred', from: 'no host-matching account' },
    });
  });

  it('host comparison is normalized on both sides', () => {
    expect(
      resolveProviderAccount(undefined, [dotcomDefault], { ...hostMatching('  GITHUB.COM  ') })
    ).toEqual({
      value: dotcomDefault,
      provenance: { kind: 'inferred', from: 'default account' },
    });
  });
});

describe('resolveProviderAccountForHost', () => {
  const dotcomDefault = account({ accountId: 'dotcom', isDefault: true, host: 'github.com' });
  const ghes = account({ accountId: 'ghes', host: 'ghe.example.com' });

  it('prefers the default account on a matching host', () => {
    expect(
      resolveProviderAccountForHost([ghes, dotcomDefault], {
        ...hostMatching('github.com'),
        host: 'github.com',
      })
    ).toEqual({
      value: dotcomDefault,
      provenance: { kind: 'inferred', from: 'default account' },
    });
  });

  it('falls back to the only matching account', () => {
    expect(
      resolveProviderAccountForHost([dotcomDefault, ghes], {
        ...hostMatching('ghe.example.com'),
        host: 'ghe.example.com',
      })
    ).toEqual({
      value: ghes,
      provenance: { kind: 'inferred', from: 'only host-matching account' },
    });
  });

  it('finds nothing when no account matches', () => {
    expect(
      resolveProviderAccountForHost([dotcomDefault], {
        ...hostMatching('gitlab.com'),
        host: 'gitlab.com',
      })
    ).toEqual({ value: null, provenance: { kind: 'inferred', from: 'no host-matching account' } });
  });
});

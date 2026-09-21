import { describe, expect, it } from 'vitest';
import { classifyProjectAccountResolution } from './project-account-context';

const options = {
  accountsConnected: true,
  disabledMessage: 'disabled',
  unresolvableMessage: 'unresolvable',
};

describe('classifyProjectAccountResolution', () => {
  it('passes a resolved account through', () => {
    expect(
      classifyProjectAccountResolution(
        { value: { accountId: 'a' }, provenance: { kind: 'set' } },
        options
      )
    ).toEqual({ kind: 'account', account: { accountId: 'a' } });
  });

  it('reports explicit none as unavailable with set provenance and the disabled message', () => {
    expect(
      classifyProjectAccountResolution({ value: null, provenance: { kind: 'set' } }, options)
    ).toEqual({
      kind: 'unavailable',
      error: {
        type: 'account_unavailable',
        provenance: { kind: 'set' },
        accountsConnected: true,
        message: 'disabled',
      },
    });
  });

  it('reports a dangling pin as unavailable with unresolvable provenance', () => {
    expect(
      classifyProjectAccountResolution(
        { value: null, provenance: { kind: 'unresolvable' } },
        { ...options, accountsConnected: false }
      )
    ).toEqual({
      kind: 'unavailable',
      error: {
        type: 'account_unavailable',
        provenance: { kind: 'unresolvable' },
        accountsConnected: false,
        message: 'unresolvable',
      },
    });
  });

  it('returns inferred-none for inferred absence, leaving divergence to callers', () => {
    expect(
      classifyProjectAccountResolution(
        { value: null, provenance: { kind: 'inferred', from: 'default account' } },
        options
      )
    ).toEqual({ kind: 'inferred-none' });
  });
});

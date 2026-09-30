import { describe, expect, it } from 'vitest';
import { providerAccountReportingState } from './account-reporting';

describe('providerAccountReportingState', () => {
  it('maps explicit none to the quiet disabled state regardless of accounts', () => {
    expect(providerAccountReportingState('GitHub', { kind: 'set' }, true)).toEqual({
      kind: 'disabled',
      message: 'GitHub is disabled for this project.',
    });
    expect(providerAccountReportingState('GitHub', { kind: 'set' }, false)).toEqual({
      kind: 'disabled',
      message: 'GitHub is disabled for this project.',
    });
  });

  it('maps inferred-absent with zero accounts to the connect state', () => {
    expect(
      providerAccountReportingState(
        'GitHub',
        { kind: 'inferred', from: 'no host-matching account' },
        false
      )
    ).toEqual({
      kind: 'connect',
      message: 'Connect a GitHub account to get started.',
    });
  });

  it('maps inferred-absent with accounts to the silent default', () => {
    expect(
      providerAccountReportingState(
        'GitHub',
        { kind: 'inferred', from: 'no host-matching account' },
        true
      )
    ).toEqual({ kind: 'silent' });
  });

  it('fails closed on an unresolvable pin with a fix message', () => {
    expect(providerAccountReportingState('GitHub', { kind: 'unresolvable' }, true)).toEqual({
      kind: 'unresolvable',
      message: 'The selected GitHub account is no longer connected.',
    });
  });
});

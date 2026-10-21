import { describe, expect, it } from 'vitest';
import type { Resolved } from '@core/primitives/project-settings/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { identityStripView } from './identity-strip-state';

function resolved(
  value: ProviderAccountSummary | null,
  provenance: Resolved<ProviderAccountSummary | null>['provenance']
): Resolved<ProviderAccountSummary | null> {
  return { value, provenance };
}

describe.each([
  { providerId: 'github', providerName: 'GitHub' },
  { providerId: 'linear', providerName: 'Linear' },
])('identityStripView ($providerId)', ({ providerId, providerName }) => {
  function account(accountId: string): ProviderAccountSummary {
    return {
      providerId,
      displayName: accountId,
      accountId,
      isDefault: false,
    };
  }

  it('shows a popover override as set for this action, over any resolver outcome', () => {
    const chosen = account('a2');
    const view = identityStripView(providerName, resolved(null, { kind: 'unresolvable' }), chosen, [
      account('a1'),
      chosen,
    ]);
    expect(view).toEqual({
      kind: 'account',
      account: chosen,
      provenance: { kind: 'set' },
      isActionOverride: true,
    });
  });

  it('shows the resolved account with its own provenance when nothing is overridden', () => {
    const inferred = account('a1');
    const view = identityStripView(
      providerName,
      resolved(inferred, { kind: 'inferred', from: 'default account' }),
      null,
      [inferred]
    );
    expect(view).toEqual({
      kind: 'account',
      account: inferred,
      provenance: { kind: 'inferred', from: 'default account' },
      isActionOverride: false,
    });
  });

  it('maps explicit none to the quiet disabled row', () => {
    const view = identityStripView(providerName, resolved(null, { kind: 'set' }), null, [
      account('a1'),
    ]);
    expect(view.kind).toBe('disabled');
  });

  it('maps zero accounts to the connect empty state', () => {
    const view = identityStripView(
      providerName,
      resolved(null, { kind: 'inferred', from: 'no host-matching account' }),
      null,
      []
    );
    expect(view.kind).toBe('connect');
  });

  it('maps inferred-absent with accounts connected to the no-match row', () => {
    const view = identityStripView(
      providerName,
      resolved(null, { kind: 'inferred', from: 'no host-matching account' }),
      null,
      [account('a1')]
    );
    expect(view.kind).toBe('no-match');
  });

  it('fails closed on an unresolvable pin', () => {
    const view = identityStripView(providerName, resolved(null, { kind: 'unresolvable' }), null, [
      account('a1'),
    ]);
    expect(view).toEqual({
      kind: 'unresolvable',
      message: `The selected ${providerName} account is no longer connected.`,
    });
  });
});

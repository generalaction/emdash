import { describe, expect, it } from 'vitest';
import type { IntegrationAccountSummary } from '@core/primitives/integrations/api';
import { resolveIntegrationAccount } from './effective-settings';

function account(
  accountId: string,
  isDefault = false,
  extra: Partial<IntegrationAccountSummary> = {}
): IntegrationAccountSummary {
  return { accountId, integrationId: 'linear', isDefault, ...extra };
}

describe('resolveIntegrationAccount', () => {
  const acme = account('linear:acme', true, { workspaceLabel: 'Acme' });
  const beta = account('linear:beta', false, { workspaceLabel: 'Beta' });

  it('resolves an explicit pin to the pinned account (set)', () => {
    const result = resolveIntegrationAccount({ kind: 'account', accountId: 'linear:beta' }, [
      acme,
      beta,
    ]);
    expect(result).toEqual({ value: beta, provenance: { kind: 'set' } });
  });

  it('fails closed on a dangling pin (unresolvable), never another workspace', () => {
    const result = resolveIntegrationAccount({ kind: 'account', accountId: 'linear:gone' }, [
      acme,
      beta,
    ]);
    expect(result).toEqual({ value: null, provenance: { kind: 'unresolvable' } });
  });

  it('treats { kind: "none" } as explicit disable (set, null)', () => {
    const result = resolveIntegrationAccount({ kind: 'none' }, [acme, beta]);
    expect(result).toEqual({ value: null, provenance: { kind: 'set' } });
  });

  it('infers the default account when no pin is set', () => {
    const result = resolveIntegrationAccount(undefined, [beta, acme]);
    expect(result).toEqual({
      value: acme,
      provenance: { kind: 'inferred', from: 'default account' },
    });
  });

  it('infers the only account when no default is flagged', () => {
    const result = resolveIntegrationAccount(undefined, [beta]);
    expect(result).toEqual({
      value: beta,
      provenance: { kind: 'inferred', from: 'only account' },
    });
  });

  it('resolves to nothing when multiple accounts exist and none is default', () => {
    const result = resolveIntegrationAccount(undefined, [
      account('linear:one'),
      account('linear:two'),
    ]);
    expect(result).toEqual({
      value: null,
      provenance: { kind: 'inferred', from: 'no connected account' },
    });
  });

  it('resolves to nothing with no connected accounts', () => {
    const result = resolveIntegrationAccount(undefined, []);
    expect(result).toEqual({
      value: null,
      provenance: { kind: 'inferred', from: 'no connected account' },
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { StoredBaseProjectSettings } from '@core/primitives/project-settings/api';
import { applyIntegrationAccountsPatch } from './durable-project-settings';

describe('applyIntegrationAccountsPatch', () => {
  it('leaves the stored map untouched when the patch is absent', () => {
    const next: StoredBaseProjectSettings = {
      integrationAccounts: { github: { kind: 'none' } },
    };
    applyIntegrationAccountsPatch(next, undefined);
    expect(next.integrationAccounts).toEqual({ github: { kind: 'none' } });
  });

  it('sets and clears per provider without touching other keys', () => {
    const next: StoredBaseProjectSettings = {
      integrationAccounts: {
        github: { kind: 'account', accountId: 'github.com:42' },
        jira: { kind: 'none' },
      },
    };
    applyIntegrationAccountsPatch(next, {
      jira: null,
      linear: { kind: 'account', accountId: 'linear:x' },
    });
    expect(next.integrationAccounts).toEqual({
      github: { kind: 'account', accountId: 'github.com:42' },
      linear: { kind: 'account', accountId: 'linear:x' },
    });
  });

  it('stores an emptied map as absence', () => {
    const next: StoredBaseProjectSettings = {
      integrationAccounts: { github: { kind: 'none' } },
    };
    applyIntegrationAccountsPatch(next, { github: null });
    expect(next).not.toHaveProperty('integrationAccounts');
  });

  it('creates the map on first set', () => {
    const next: StoredBaseProjectSettings = {};
    applyIntegrationAccountsPatch(next, { github: { kind: 'none' } });
    expect(next.integrationAccounts).toEqual({ github: { kind: 'none' } });
  });

  it('clearing on an absent map stays absent', () => {
    const next: StoredBaseProjectSettings = {};
    applyIntegrationAccountsPatch(next, { github: null });
    expect(next).not.toHaveProperty('integrationAccounts');
  });
});

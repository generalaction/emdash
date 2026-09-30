import { describe, expect, it } from 'vitest';
import {
  getIntegrationAuthUi,
  supportsIntegrationReconnect,
} from './integration-auth-contributions';

describe('integration authentication UI contributions', () => {
  it('selects the provider UI only for its declared acquisition methods', () => {
    expect(
      getIntegrationAuthUi({
        id: 'github',
        auth: { methods: [{ kind: 'oauth', providerId: 'github' }] },
      })?.integrationId
    ).toBe('github');
    expect(
      getIntegrationAuthUi({
        id: 'github',
        auth: { methods: [{ kind: 'form', fields: [] }] },
      })
    ).toBeUndefined();
  });

  it.each(['github', 'linear', 'future-provider'])(
    'supports account-preserving form reconnect based on capability for %s',
    (id) => {
      expect(
        supportsIntegrationReconnect({
          id,
          auth: { methods: [{ kind: 'form', fields: [] }] },
        })
      ).toBe(true);
    }
  );

  it('does not present selected-account reconnect for acquisition flows that can change identity', () => {
    expect(
      supportsIntegrationReconnect({
        id: 'github',
        auth: { methods: [{ kind: 'oauth', providerId: 'github' }] },
      })
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveProviderEnv } from './provider-env';

describe('resolveProviderEnv', () => {
  it('returns valid provider environment variables', () => {
    expect(
      resolveProviderEnv({
        env: {
          ANTHROPIC_BASE_URL: 'https://example.test',
          _TOKEN: 'secret',
          'INVALID-NAME': 'ignored',
          '1TOKEN': 'ignored',
        },
      })
    ).toEqual({
      ANTHROPIC_BASE_URL: 'https://example.test',
      _TOKEN: 'secret',
    });
  });

  it('returns undefined when no valid provider environment variables exist', () => {
    expect(resolveProviderEnv(undefined)).toBeUndefined();
    expect(resolveProviderEnv({ env: { 'INVALID-NAME': 'ignored' } })).toBeUndefined();
  });
});

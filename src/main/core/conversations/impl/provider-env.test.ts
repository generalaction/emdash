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

  it('sets inline opencode permissions when auto-approve is enabled', () => {
    expect(resolveProviderEnv(undefined, { providerId: 'opencode', autoApprove: true })).toEqual({
      OPENCODE_PERMISSION: '{"*":"allow"}',
    });
  });

  it('does not set inline opencode permissions when auto-approve is disabled', () => {
    expect(resolveProviderEnv(undefined, { providerId: 'opencode', autoApprove: false })).toBeUndefined();
  });

  it('preserves custom opencode permissions when auto-approve is enabled', () => {
    expect(
      resolveProviderEnv(
        { env: { OPENCODE_PERMISSION: '{"edit":"allow","bash":"ask"}' } },
        { providerId: 'opencode', autoApprove: true }
      )
    ).toEqual({
      OPENCODE_PERMISSION: '{"edit":"allow","bash":"ask"}',
    });
  });

  it('does not set inline opencode permissions for other providers', () => {
    expect(
      resolveProviderEnv(undefined, { providerId: 'claude', autoApprove: true })
    ).toBeUndefined();
  });
});

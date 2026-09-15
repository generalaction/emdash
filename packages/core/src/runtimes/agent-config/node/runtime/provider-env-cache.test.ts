import { describe, expect, it } from 'vitest';
import { ProviderEnvCache } from './provider-env-cache';

describe('ProviderEnvCache', () => {
  it('returns undefined for a provider id that was never set', () => {
    const cache = new ProviderEnvCache();

    expect(cache.get('claude')).toBeUndefined();
  });

  it('remembers the last env explicitly set for a provider id', () => {
    const cache = new ProviderEnvCache();

    cache.set('claude-axoniq', { CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });

    expect(cache.get('claude-axoniq')).toEqual({ CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });
  });

  it('clears a previously set entry when set is called with undefined', () => {
    const cache = new ProviderEnvCache();
    cache.set('claude-axoniq', { CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });

    cache.set('claude-axoniq', undefined);

    expect(cache.get('claude-axoniq')).toBeUndefined();
  });

  it('keeps entries for different provider ids independent', () => {
    const cache = new ProviderEnvCache();

    cache.set('claude', { CLAUDE_CONFIG_DIR: '/home/user/.claude' });
    cache.set('claude-axoniq', { CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });

    expect(cache.get('claude')).toEqual({ CLAUDE_CONFIG_DIR: '/home/user/.claude' });
    expect(cache.get('claude-axoniq')).toEqual({ CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });
  });

  it('clear removes every entry', () => {
    const cache = new ProviderEnvCache();
    cache.set('claude', { CLAUDE_CONFIG_DIR: '/home/user/.claude' });

    cache.clear();

    expect(cache.get('claude')).toBeUndefined();
  });
});

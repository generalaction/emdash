import { describe, expect, it, vi } from 'vitest';
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
  it('notifies listeners only when a provider env actually changes', () => {
    const cache = new ProviderEnvCache();
    const listener = vi.fn();
    cache.onChange(listener);

    cache.set('claude', { A: '1', B: '2' });
    cache.set('claude', { B: '2', A: '1' });
    cache.set('claude', { A: '1', B: '3' });
    cache.set('claude', undefined);
    cache.set('claude', undefined);

    expect(listener.mock.calls).toEqual([['claude'], ['claude'], ['claude']]);
  });

  it('stops notifying after unsubscribe', () => {
    const cache = new ProviderEnvCache();
    const listener = vi.fn();
    const unsubscribe = cache.onChange(listener);

    unsubscribe();
    cache.set('claude', { A: '1' });

    expect(listener).not.toHaveBeenCalled();
  });
});

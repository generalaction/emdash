import { beforeEach, describe, expect, it, vi } from 'vitest';
import { providerTokenRegistry } from './provider-token-registry';

describe('providerTokenRegistry', () => {
  beforeEach(() => {
    providerTokenRegistry.clear();
  });

  it('dispatches to registered handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    providerTokenRegistry.register('github', handler);

    await providerTokenRegistry.dispatch('github', 'ghp_token123');

    expect(handler).toHaveBeenCalledWith('ghp_token123');
  });

  it('is a no-op when no handler is registered for the provider', async () => {
    await expect(providerTokenRegistry.dispatch('gitlab', 'token')).resolves.not.toThrow();
  });

  it('propagates handler errors', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('secure storage failed'));
    providerTokenRegistry.register('github', handler);

    await expect(providerTokenRegistry.dispatch('github', 'token')).rejects.toThrow(
      'secure storage failed'
    );
  });

  it('replaces handler on re-registration', async () => {
    const first = vi.fn();
    const second = vi.fn();
    providerTokenRegistry.register('github', first);
    providerTokenRegistry.register('github', second);

    await providerTokenRegistry.dispatch('github', 'token');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('token');
  });
});

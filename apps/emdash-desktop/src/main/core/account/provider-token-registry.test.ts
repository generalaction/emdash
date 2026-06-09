import { beforeEach, describe, expect, it } from 'vitest';
import { providerTokenRegistry } from './provider-token-registry';

describe('providerTokenRegistry', () => {
  beforeEach(() => {
    providerTokenRegistry.clear();
  });

  it('dispatches to registered handler', async () => {
    const calls: unknown[] = [];
    const handler = async (payload: unknown) => {
      calls.push(payload);
    };
    providerTokenRegistry.register('github', handler);

    await providerTokenRegistry.dispatch('github', { accessToken: 'ghp_token123' });

    expect(calls).toEqual([{ accessToken: 'ghp_token123' }]);
  });

  it('dispatches provider account metadata with the token payload', async () => {
    const calls: unknown[] = [];
    providerTokenRegistry.register('github', async (payload) => {
      calls.push(payload);
    });

    await providerTokenRegistry.dispatch('github', {
      accessToken: 'ghp_token123',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
      },
    });

    expect(calls).toEqual([
      {
        accessToken: 'ghp_token123',
        providerAccount: {
          providerId: 'github',
          providerAccountId: '42',
          host: 'github.com',
          login: 'monalisa',
          avatarUrl: 'https://avatars.githubusercontent.com/u/42',
        },
      },
    ]);
  });

  it('is a no-op when no handler is registered for the provider', async () => {
    await expect(
      providerTokenRegistry.dispatch('gitlab', { accessToken: 'token' })
    ).resolves.not.toThrow();
  });

  it('propagates handler errors', async () => {
    const handler = async () => {
      throw new Error('secure storage failed');
    };
    providerTokenRegistry.register('github', handler);

    await expect(
      providerTokenRegistry.dispatch('github', { accessToken: 'token' })
    ).rejects.toThrow('secure storage failed');
  });

  it('replaces handler on re-registration', async () => {
    const calls: string[] = [];
    const first = async () => {
      calls.push('first');
    };
    const second = async () => {
      calls.push('second');
    };
    providerTokenRegistry.register('github', first);
    providerTokenRegistry.register('github', second);

    await providerTokenRegistry.dispatch('github', { accessToken: 'token' });

    expect(calls).toEqual(['second']);
  });
});

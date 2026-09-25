import { describe, expect, it, vi } from 'vitest';
import { verifyForgejoCredentials } from './client';

vi.mock('@llamaduck/forgejo-ts/client', () => ({ createClient: vi.fn() }));
vi.mock('@llamaduck/forgejo-ts', () => ({
  userGetCurrent: async () => ({ data: { id: 1, login: 'ada', full_name: 'Ada' } }),
}));

describe('Forgejo installation identity', () => {
  it('keeps two installations on one host separate', async () => {
    const first = await verifyForgejoCredentials({
      instanceUrl: 'https://example.com/a/',
      apiToken: 'one',
    });
    const second = await verifyForgejoCredentials({
      instanceUrl: 'https://example.com/b',
      apiToken: 'two',
    });
    if (!first.success || !second.success) throw new Error('Expected verified accounts');
    expect(first.data.account?.scope).toBe('https://example.com/a');
    expect(second.data.account?.scope).toBe('https://example.com/b');
    expect(first.data.account?.host).toBe(second.data.account?.host);
  });
});

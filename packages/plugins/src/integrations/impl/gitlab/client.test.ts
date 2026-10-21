import { describe, expect, it, vi } from 'vitest';
import { verifyGitLabCredentials } from './client';

vi.mock('@gitbeaker/rest', () => ({
  Gitlab: class {
    Users = { showCurrentUser: async () => ({ id: 1, username: 'ada', name: 'Ada' }) };
  },
}));

describe('GitLab installation identity', () => {
  it('keeps two installations on one host separate', async () => {
    const first = await verifyGitLabCredentials({
      instanceUrl: 'https://example.com/a/',
      apiToken: 'one',
    });
    const second = await verifyGitLabCredentials({
      instanceUrl: 'https://example.com/b',
      apiToken: 'two',
    });
    if (!first.success || !second.success) throw new Error('Expected verified accounts');
    expect(first.data.account?.scope).toBe('https://example.com/a');
    expect(second.data.account?.scope).toBe('https://example.com/b');
    expect(first.data.account?.host).toBe(second.data.account?.host);
  });
});

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountProfileCache, type CachedProfile } from './profile-cache';

const mockGetPath = vi.fn().mockReturnValue('/mock/userData');

vi.mock('electron', () => ({
  app: { getPath: (...args: unknown[]) => mockGetPath(...args) },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('AccountProfileCache', () => {
  let cache: AccountProfileCache;
  const testProfile: CachedProfile = {
    hasAccount: true,
    userId: 'user-1',
    username: 'testuser',
    avatarUrl: 'https://example.com/avatar.png',
    email: 'test@example.com',
    lastValidated: '2026-03-17T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new AccountProfileCache();
  });

  describe('read()', () => {
    it('returns parsed profile when file exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(testProfile));
      const result = cache.read();
      expect(result).toEqual(testProfile);
    });

    it('returns null when file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(cache.read()).toBeNull();
    });

    it('returns null on parse error', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('invalid json');
      expect(cache.read()).toBeNull();
    });
  });

  describe('write()', () => {
    it('writes profile as JSON', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      cache.write(testProfile);
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('emdash-account.json'),
        JSON.stringify(testProfile, null, 2)
      );
    });
  });
});

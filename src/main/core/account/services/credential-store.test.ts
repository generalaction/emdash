import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCredentialStore } from './credential-store';

const mockGetPassword = vi.fn();
const mockSetPassword = vi.fn();
const mockDeletePassword = vi.fn();

vi.mock('keytar', () => ({
  getPassword: (...args: unknown[]) => mockGetPassword(...args),
  setPassword: (...args: unknown[]) => mockSetPassword(...args),
  deletePassword: (...args: unknown[]) => mockDeletePassword(...args),
}));

describe('AccountCredentialStore', () => {
  let store: AccountCredentialStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new AccountCredentialStore();
  });

  describe('get()', () => {
    it('returns token from keytar', async () => {
      mockGetPassword.mockResolvedValue('session-token-123');
      const token = await store.get();
      expect(token).toBe('session-token-123');
      expect(mockGetPassword).toHaveBeenCalledWith('emdash-account', 'session-token');
    });

    it('returns null when keytar has no token', async () => {
      mockGetPassword.mockResolvedValue(null);
      const token = await store.get();
      expect(token).toBeNull();
    });

    it('returns null on keytar error', async () => {
      mockGetPassword.mockRejectedValue(new Error('keytar unavailable'));
      const token = await store.get();
      expect(token).toBeNull();
    });
  });

  describe('set()', () => {
    it('stores token in keytar', async () => {
      await store.set('new-token');
      expect(mockSetPassword).toHaveBeenCalledWith('emdash-account', 'session-token', 'new-token');
    });

    it('throws on keytar error', async () => {
      mockSetPassword.mockRejectedValue(new Error('keytar write failed'));
      await expect(store.set('token')).rejects.toThrow('keytar write failed');
    });
  });

  describe('clear()', () => {
    it('deletes token from keytar', async () => {
      await store.clear();
      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-account', 'session-token');
    });

    it('does not throw on keytar error', async () => {
      mockDeletePassword.mockRejectedValue(new Error('keytar error'));
      await expect(store.clear()).resolves.not.toThrow();
    });
  });
});

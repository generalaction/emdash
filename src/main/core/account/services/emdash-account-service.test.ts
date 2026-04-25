import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmdashAccountService } from './emdash-account-service';

const mockCredGet = vi.fn();
const mockCredSet = vi.fn();
const mockCredClear = vi.fn();
vi.mock('./credential-store', () => ({
  accountCredentialStore: {
    get: (...args: unknown[]) => mockCredGet(...args),
    set: (...args: unknown[]) => mockCredSet(...args),
    clear: (...args: unknown[]) => mockCredClear(...args),
  },
}));

const mockKvGet = vi.fn();
const mockKvSet = vi.fn();
vi.mock('@main/db/kv', () => ({
  KV: class {
    get(...args: unknown[]) {
      return mockKvGet(...args);
    }
    set(...args: unknown[]) {
      return mockKvSet(...args);
    }
  },
}));

const mockExecuteOAuthFlow = vi.fn();
vi.mock('@main/core/shared/oauth-flow', () => ({
  executeOAuthFlow: (...args: unknown[]) => mockExecuteOAuthFlow(...args),
}));

const mockDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock('../provider-token-registry', () => ({
  providerTokenRegistry: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  },
}));

vi.mock('../config', () => ({
  ACCOUNT_CONFIG: {
    authServer: { baseUrl: 'https://auth.test.emdash.sh', authTimeoutMs: 5000 },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('EmdashAccountService', () => {
  let service: EmdashAccountService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue(undefined);
    service = new EmdashAccountService();
  });

  describe('getSession()', () => {
    it('returns no account when profile cache is empty', async () => {
      const session = await service.getSession();
      expect(session).toEqual({ user: null, isSignedIn: false, hasAccount: false });
    });

    it('returns hasAccount true but not signed in when profile exists but no token', async () => {
      mockKvGet.mockResolvedValue({
        hasAccount: true,
        userId: 'u1',
        username: 'test',
        avatarUrl: '',
        email: 'test@test.com',
        lastValidated: '2026-01-01',
      });
      const session = await service.getSession();
      expect(session.hasAccount).toBe(true);
      expect(session.isSignedIn).toBe(false);
      expect(session.user).toBeNull();
    });
  });

  describe('loadSessionToken()', () => {
    it('loads token from credential store', async () => {
      mockCredGet.mockResolvedValue('token-123');
      await service.loadSessionToken();
      expect(mockCredGet).toHaveBeenCalled();
    });
  });

  describe('signIn()', () => {
    it('calls executeOAuthFlow and stores session', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: {
          userId: 'u1',
          username: 'testuser',
          avatarUrl: 'https://img.com/a',
          email: 'a@b.com',
        },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);

      const result = await service.signIn();

      expect(mockExecuteOAuthFlow).toHaveBeenCalledWith(expect.objectContaining({}));
      expect(mockCredSet).toHaveBeenCalledWith('session-abc');
      expect(mockKvSet).toHaveBeenCalledWith(
        'profile',
        expect.objectContaining({ hasAccount: true, username: 'testuser' })
      );
      expect(result).toEqual({
        providerToken: 'ghp_123',
        provider: 'github',
        user: oauthResponse.user,
      });
    });

    it('passes provider as extraParam when specified', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);

      await service.signIn('github');

      expect(mockExecuteOAuthFlow).toHaveBeenCalledWith(expect.objectContaining({}));
    });

    it('dispatches provider token via registry when provider token is present', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);

      await service.signIn();

      expect(mockDispatch).toHaveBeenCalledWith('github', 'ghp_123');
    });

    it('throws when provider token persistence fails', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);
      mockDispatch.mockRejectedValueOnce(new Error('secure storage failed'));

      await expect(service.signIn()).rejects.toThrow('secure storage failed');
    });

    it('does not dispatch when provider token is absent', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);

      await service.signIn();

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('signOut()', () => {
    it('clears session token and preserves hasAccount in profile cache', async () => {
      const exchangeResult = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(exchangeResult);
      await service.signIn();
      vi.clearAllMocks();
      mockKvSet.mockResolvedValue(undefined);

      await service.signOut();

      expect(mockCredClear).toHaveBeenCalled();
      expect(mockKvSet).toHaveBeenCalledWith(
        'profile',
        expect.objectContaining({ hasAccount: true })
      );
      mockKvGet.mockResolvedValue({
        hasAccount: true,
        userId: 'u1',
        username: 'test',
        avatarUrl: '',
        email: '',
      });
      const session = await service.getSession();
      expect(session.isSignedIn).toBe(false);
      expect(session.hasAccount).toBe(true);
    });
  });

  describe('validateSession()', () => {
    it('returns false when no session token', async () => {
      const result = await service.validateSession();
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('clears session on 401 and preserves hasAccount', async () => {
      const exchangeResult = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(exchangeResult);
      await service.signIn();
      vi.clearAllMocks();
      mockKvSet.mockResolvedValue(undefined);

      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      const result = await service.validateSession();

      expect(result).toBe(false);
      expect(mockCredClear).toHaveBeenCalled();
      expect(mockKvSet).toHaveBeenCalledWith(
        'profile',
        expect.objectContaining({ hasAccount: true })
      );
    });

    it('returns true on network error (optimistic)', async () => {
      const exchangeResult = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(exchangeResult);
      await service.signIn();
      vi.clearAllMocks();

      mockFetch.mockRejectedValue(new Error('network error'));
      const result = await service.validateSession();
      expect(result).toBe(true);
    });
  });

  describe('checkServerHealth()', () => {
    it('returns true on successful health check', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const result = await service.checkServerHealth();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.test.emdash.sh/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('returns false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));
      const result = await service.checkServerHealth();
      expect(result).toBe(false);
    });
  });
});

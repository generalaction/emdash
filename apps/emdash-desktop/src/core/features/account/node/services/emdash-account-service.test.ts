import { err, ok, type Result } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountAuthServerClient } from './account-auth-server-client';
import { AccountOAuthClient } from './account-oauth-client';
import { AccountSessionStore } from './account-session-store';
import { EmdashAccountService } from './emdash-account-service';
import { ProviderTokenDispatcher } from './provider-token-dispatcher';

const mockCredGet = vi.fn();
const mockCredSet = vi.fn();
const mockCredClear = vi.fn();

const mockKvGet = vi.fn();
const mockKvSet = vi.fn();

const mockExecuteOAuthFlow = vi.fn();
const mockDispatch = vi.fn().mockResolvedValue(undefined);
const mockSupports = vi.fn((provider: string) => provider === 'github' || provider === 'gitlab');

vi.mock('../config', () => ({
  ACCOUNT_CONFIG: {
    authServer: { baseUrl: 'https://auth.test.emdash.sh', authTimeoutMs: 5000 },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function unwrapResult<T, E>(result: Result<T, E>): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(`Expected ok result, got ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

function unwrapError<T, E>(result: Result<T, E>): E {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error(`Expected error result, got ${JSON.stringify(result.data)}`);
  }
  return result.error;
}

describe('EmdashAccountService', () => {
  let service: EmdashAccountService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCredGet.mockResolvedValue(ok(null));
    mockCredSet.mockResolvedValue(ok());
    mockCredClear.mockResolvedValue(ok());
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue(undefined);
    mockFetch.mockReset();
    mockExecuteOAuthFlow.mockReset();
    mockDispatch.mockResolvedValue(undefined);
    service = new EmdashAccountService(
      new AccountSessionStore(
        {
          get: (...args) => mockKvGet(...args),
          setOrThrow: (...args) => mockKvSet(...args),
        },
        {
          get: (...args) => mockCredGet(...args),
          set: (...args) => mockCredSet(...args),
          clear: (...args) => mockCredClear(...args),
        }
      ),
      new AccountAuthServerClient(),
      new AccountOAuthClient((options) => mockExecuteOAuthFlow(options)),
      new ProviderTokenDispatcher({
        supports: (provider) => mockSupports(provider),
        store: (...args) => mockDispatch(...args),
      })
    );
  });

  describe('getSession()', () => {
    it('returns no account when profile cache is empty', async () => {
      const session = unwrapResult(await service.getSession());
      expect(session).toEqual({ user: null, isSignedIn: false, hasAccount: false });
    });

    it('returns hasAccount true but not signed in when profile exists but no token', async () => {
      mockKvGet.mockResolvedValue({
        hasAccount: true,
        userId: 'u1',
        name: 'Test User',
        username: 'test',
        avatarUrl: '',
        email: 'test@test.com',
        lastValidated: '2026-01-01',
      });
      const session = unwrapResult(await service.getSession());
      expect(session.hasAccount).toBe(true);
      expect(session.isSignedIn).toBe(false);
      expect(session.user).toBeNull();
    });

    it('returns the cached user name when signed in', async () => {
      mockCredGet.mockResolvedValue(ok('token-123'));
      mockKvGet.mockResolvedValue({
        hasAccount: true,
        userId: 'u1',
        name: 'Test User',
        username: 'test',
        avatarUrl: '',
        email: 'test@test.com',
        lastValidated: '2026-01-01',
      });

      unwrapResult(await service.loadSessionToken());
      const session = unwrapResult(await service.getSession());

      expect(session.user).toEqual({
        userId: 'u1',
        name: 'Test User',
        username: 'test',
        avatarUrl: '',
        email: 'test@test.com',
      });
    });
  });

  describe('loadSessionToken()', () => {
    it('loads token from credential store', async () => {
      mockCredGet.mockResolvedValue(ok('token-123'));
      unwrapResult(await service.loadSessionToken());
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
          name: 'Test User',
          username: 'testuser',
          avatarUrl: 'https://img.com/a',
          email: 'a@b.com',
        },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);

      const result = unwrapResult(await service.signIn());

      expect(mockExecuteOAuthFlow).toHaveBeenCalledWith(expect.objectContaining({}));
      expect(mockCredSet).toHaveBeenCalledWith('session-abc');
      expect(mockKvSet).toHaveBeenCalledWith(
        'profile',
        expect.objectContaining({ hasAccount: true, name: 'Test User', username: 'testuser' })
      );
      expect(result).toEqual({
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

      unwrapResult(await service.signIn('github'));

      expect(mockExecuteOAuthFlow).toHaveBeenCalledWith(expect.objectContaining({}));
    });

    it('stores the provider token when the auth server issues one', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        providerAccount: {
          providerId: 'github',
          providerAccountId: '42',
          host: 'github.com',
          login: 'monalisa',
          avatarUrl: 'https://avatars.githubusercontent.com/u/42',
        },
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);

      unwrapResult(await service.signIn());

      expect(mockDispatch).toHaveBeenCalledWith('github', {
        accessToken: 'ghp_123',
        providerAccount: {
          providerId: 'github',
          providerAccountId: '42',
          host: 'github.com',
          login: 'monalisa',
          avatarUrl: 'https://avatars.githubusercontent.com/u/42',
        },
      });
    });

    it('ignores malformed provider account metadata from the auth server', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        providerAccount: {
          providerId: 'github',
          host: 'github.com',
          login: 'monalisa',
        },
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);

      unwrapResult(await service.signIn());

      expect(mockDispatch).toHaveBeenCalledWith('github', {
        accessToken: 'ghp_123',
        providerAccount: undefined,
      });
    });

    it('returns a typed error when provider token persistence fails', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);
      mockDispatch.mockRejectedValueOnce(new Error('secure storage failed'));

      const error = unwrapError(await service.signIn());
      expect(error).toMatchObject({
        type: 'provider_token_persistence_failed',
        provider: 'github',
        message: 'secure storage failed',
      });
    });

    it('does not dispatch when provider token is absent', async () => {
      const oauthResponse = {
        sessionToken: 'session-abc',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);

      unwrapResult(await service.signIn());

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('linkProviderAccount()', () => {
    it('starts an account-link transaction and stores the linked provider token', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accountLinkState: 'account-link-state' }),
      });
      const oauthResponse = {
        accessToken: 'ghp_linked',
        providerId: 'github',
        providerAccount: {
          providerId: 'github',
          providerAccountId: '84',
          host: 'github.com',
          login: 'octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/84',
        },
      };
      mockExecuteOAuthFlow.mockResolvedValue(oauthResponse);
      mockDispatch.mockResolvedValueOnce({
        providerAccountStatus: 'created',
        providerAccount: oauthResponse.providerAccount,
      });

      const result = unwrapResult(await service.linkProviderAccount());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.test.emdash.sh/api/v1/auth/electron/account-link/start?provider_id=github',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer session-abc' },
          signal: expect.any(AbortSignal),
        })
      );
      expect(mockExecuteOAuthFlow).toHaveBeenCalledWith({
        authorizeUrl: 'https://auth.test.emdash.sh/api/v1/auth/electron/account-link/authorize',
        exchangeUrl: 'https://auth.test.emdash.sh/api/v1/auth/electron/exchange',
        successRedirectUrl: 'https://auth.test.emdash.sh/auth/success',
        errorRedirectUrl: 'https://auth.test.emdash.sh/auth/error',
        extraParams: {
          account_link_state: 'account-link-state',
          provider_id: 'github',
        },
        timeoutMs: 5000,
      });
      expect(mockDispatch).toHaveBeenCalledWith('github', {
        accessToken: 'ghp_linked',
        providerAccount: {
          providerId: 'github',
          providerAccountId: '84',
          host: 'github.com',
          login: 'octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/84',
        },
      });
      expect(result).toEqual({
        provider: 'github',
        providerAccountStatus: 'created',
        providerAccount: {
          providerId: 'github',
          providerAccountId: '84',
          host: 'github.com',
          login: 'octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/84',
        },
      });
    });

    it('reports when the linked provider account already exists', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accountLinkState: 'account-link-state' }),
      });
      const providerAccount = {
        providerId: 'github',
        providerAccountId: '84',
        host: 'github.com',
        login: 'octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/84',
      };
      mockExecuteOAuthFlow.mockResolvedValue({
        accessToken: 'ghp_linked',
        providerId: 'github',
        providerAccount,
      });
      mockDispatch.mockResolvedValueOnce({
        providerAccountStatus: 'updated',
        providerAccount,
      });

      const result = unwrapResult(await service.linkProviderAccount());

      expect(result).toEqual({
        provider: 'github',
        providerAccountStatus: 'updated',
        providerAccount,
      });
    });

    it('requires an existing Emdash session', async () => {
      mockCredGet.mockResolvedValue(ok(null));

      const error = unwrapError(await service.linkProviderAccount());
      expect(error).toMatchObject({
        type: 'not_signed_in',
        message: 'You must be signed in to link a provider account',
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('links a GitLab account and keeps its token expiry', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accountLinkState: 'account-link-state' }),
      });
      const providerAccount = {
        providerId: 'gitlab',
        providerAccountId: '7',
        host: 'gitlab.com',
        login: 'tanuki',
        avatarUrl: '',
      };
      mockExecuteOAuthFlow.mockResolvedValue({
        accessToken: 'glo_linked',
        accessTokenExpiresAt: '2026-10-22T12:00:00.000Z',
        providerId: 'gitlab',
        providerAccount,
      });

      unwrapResult(await service.linkProviderAccount('gitlab'));

      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.test.emdash.sh/api/v1/auth/electron/account-link/start?provider_id=gitlab',
        expect.anything()
      );
      expect(mockExecuteOAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          extraParams: { account_link_state: 'account-link-state', provider_id: 'gitlab' },
        })
      );
      expect(mockDispatch).toHaveBeenCalledWith('gitlab', {
        accessToken: 'glo_linked',
        expiresAt: Date.parse('2026-10-22T12:00:00.000Z'),
        providerAccount,
      });
    });

    it('rejects unsupported providers before starting a link transaction', async () => {
      const error = unwrapError(await service.linkProviderAccount('bitbucket'));
      expect(error).toMatchObject({
        type: 'unsupported_provider',
        provider: 'bitbucket',
        message: 'Account linking is not supported for provider "bitbucket"',
      });
      expect(mockCredGet).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
    });

    it('clears stale local session when account-link start reports no active session', async () => {
      const accountCleared = vi.fn();
      service.on('accountCleared', accountCleared);
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockKvGet.mockResolvedValue({
        hasAccount: true,
        userId: 'u1',
        username: 'test',
        avatarUrl: '',
        email: '',
        lastValidated: '2026-01-01',
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'No active session' }),
      });

      const error = unwrapError(await service.linkProviderAccount());
      expect(error).toMatchObject({
        type: 'session_expired',
        message: 'Your Emdash session expired. Sign in again.',
      });
      expect(mockCredClear).toHaveBeenCalled();
      expect(mockKvSet).toHaveBeenCalledWith(
        'profile',
        expect.objectContaining({ hasAccount: true, username: 'test' })
      );
      expect(accountCleared).toHaveBeenCalled();
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();

      const session = unwrapResult(await service.getSession());
      expect(session).toMatchObject({
        isSignedIn: false,
        hasAccount: true,
      });
    });

    it('surfaces non-session account-link start failures from the auth server', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Auth server unavailable' }),
      });

      const error = unwrapError(await service.linkProviderAccount());
      expect(error).toMatchObject({
        type: 'auth_server_error',
        message: 'Auth server unavailable',
      });
      expect(mockCredClear).not.toHaveBeenCalled();
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('rejects malformed account-link start responses', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ expiresAt: '2026-01-01T00:00:00.000Z' }),
      });

      const error = unwrapError(await service.linkProviderAccount());
      expect(error).toMatchObject({
        type: 'invalid_auth_response',
        message: 'Invalid account link start response: missing accountLinkState',
      });
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('rejects account-link exchange responses without a provider token', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accountLinkState: 'account-link-state' }),
      });
      mockExecuteOAuthFlow.mockResolvedValue({ providerId: 'github' });

      const error = unwrapError(await service.linkProviderAccount());
      expect(error).toMatchObject({
        type: 'invalid_auth_response',
        message: 'Invalid account link response: missing provider token',
      });
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('renewProviderToken()', () => {
    it('requires an Emdash session without contacting the auth server', async () => {
      mockCredGet.mockResolvedValue(ok(null));

      const error = unwrapError(await service.renewProviderToken('gitlab', '7'));
      expect(error).toMatchObject({ type: 'not_signed_in' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reads the current token of the linked account', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          providerId: 'gitlab',
          providerAccountId: '7',
          accessToken: 'glo_renewed',
          accessTokenExpiresAt: '2026-10-22T14:00:00.000Z',
        }),
      });

      const token = unwrapResult(await service.renewProviderToken('gitlab', '7'));

      expect(token).toEqual({
        accessToken: 'glo_renewed',
        expiresAt: Date.parse('2026-10-22T14:00:00.000Z'),
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.test.emdash.sh/api/v1/auth/electron/provider-token',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer session-abc', 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider_id: 'gitlab', account_id: '7' }),
        })
      );
    });

    it('returns tokens without an expiry as non-expiring', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'gho_current', accessTokenExpiresAt: null }),
      });

      expect(unwrapResult(await service.renewProviderToken('github', '42'))).toEqual({
        accessToken: 'gho_current',
      });
    });

    it('clears an expired Emdash session', async () => {
      const accountCleared = vi.fn();
      service.on('accountCleared', accountCleared);
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

      const error = unwrapError(await service.renewProviderToken('gitlab', '7'));

      expect(error).toMatchObject({ type: 'session_expired' });
      expect(mockCredClear).toHaveBeenCalled();
      expect(accountCleared).toHaveBeenCalled();
    });

    it('keeps a session signed in while a renewal for the previous one was pending', async () => {
      const accountCleared = vi.fn();
      service.on('accountCleared', accountCleared);
      mockCredGet.mockResolvedValue(ok('session-old'));
      let respond!: (response: unknown) => void;
      mockFetch.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));

      const renewal = service.renewProviderToken('gitlab', '7');
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
      mockExecuteOAuthFlow.mockResolvedValue({
        sessionToken: 'session-new',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      });
      unwrapResult(await service.signIn());
      respond({ ok: false, status: 401, json: async () => ({}) });

      expect(unwrapError(await renewal)).toMatchObject({ type: 'session_expired' });
      expect(mockCredClear).not.toHaveBeenCalled();
      expect(accountCleared).not.toHaveBeenCalled();

      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
      await service.renewProviderToken('gitlab', '7');
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer session-new' }),
        })
      );
    });

    it('reports an account that is no longer linked', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

      const error = unwrapError(await service.renewProviderToken('gitlab', '7'));

      expect(error).toMatchObject({ type: 'provider_account_not_linked', provider: 'gitlab' });
      expect(mockCredClear).not.toHaveBeenCalled();
    });

    it('reports a failed provider refresh as an auth server error', async () => {
      mockCredGet.mockResolvedValue(ok('session-abc'));
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: 'Unable to obtain a valid provider access token' }),
      });

      const error = unwrapError(await service.renewProviderToken('gitlab', '7'));

      expect(error).toMatchObject({
        type: 'auth_server_error',
        status: 502,
        message: 'Unable to obtain a valid provider access token',
      });
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
      unwrapResult(await service.signIn());
      vi.clearAllMocks();
      mockKvSet.mockResolvedValue(undefined);

      unwrapResult(await service.signOut());

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
      const session = unwrapResult(await service.getSession());
      expect(session.isSignedIn).toBe(false);
      expect(session.hasAccount).toBe(true);
    });

    it('keeps the in-memory session token when credential clearing fails', async () => {
      const exchangeResult = {
        sessionToken: 'session-abc',
        accessToken: 'ghp_123',
        providerId: 'github',
        user: { userId: 'u1', username: 'test', avatarUrl: '', email: '' },
      };
      mockExecuteOAuthFlow.mockResolvedValue(exchangeResult);
      unwrapResult(await service.signIn());
      vi.clearAllMocks();
      mockCredClear.mockResolvedValue(
        err({
          type: 'session_persistence_failed',
          message: 'Failed to clear session token',
        })
      );

      const error = unwrapError(await service.signOut());
      expect(error).toMatchObject({ type: 'session_persistence_failed' });
      expect(mockKvSet).not.toHaveBeenCalled();

      mockKvGet.mockResolvedValue({
        hasAccount: true,
        userId: 'u1',
        username: 'test',
        avatarUrl: '',
        email: '',
      });
      const session = unwrapResult(await service.getSession());
      expect(session.isSignedIn).toBe(true);
      expect(session.hasAccount).toBe(true);
    });
  });

  describe('validateSession()', () => {
    it('returns false when no session token', async () => {
      const result = unwrapResult(await service.validateSession());
      expect(result).toBe('invalid');
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
      unwrapResult(await service.signIn());
      vi.clearAllMocks();
      mockKvSet.mockResolvedValue(undefined);

      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      const result = unwrapResult(await service.validateSession());

      expect(result).toBe('invalid');
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
      unwrapResult(await service.signIn());
      vi.clearAllMocks();

      mockFetch.mockRejectedValue(new Error('network error'));
      const result = unwrapResult(await service.validateSession());
      expect(result).toBe('unknown');
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

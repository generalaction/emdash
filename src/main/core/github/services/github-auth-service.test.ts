import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubAuthServiceImpl } from './github-auth-service';

// Mock keytar
const mockGetPassword = vi.fn();
const mockSetPassword = vi.fn();
const mockDeletePassword = vi.fn();

vi.mock('keytar', () => ({
  default: {
    getPassword: (...args: unknown[]) => mockGetPassword(...args),
    setPassword: (...args: unknown[]) => mockSetPassword(...args),
    deletePassword: (...args: unknown[]) => mockDeletePassword(...args),
  },
  getPassword: (...args: unknown[]) => mockGetPassword(...args),
  setPassword: (...args: unknown[]) => mockSetPassword(...args),
  deletePassword: (...args: unknown[]) => mockDeletePassword(...args),
}));

// Mock gh-cli-token
const mockExtractGhCliToken = vi.fn();
vi.mock('./gh-cli-token', () => ({
  extractGhCliToken: (...args: unknown[]) => mockExtractGhCliToken(...args),
}));

// Mock exec
vi.mock('@main/core/utils/exec', () => ({
  getLocalExec: () => vi.fn(),
}));

// Mock events
vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@shared/events/githubEvents', () => ({
  githubAuthDeviceCodeChannel: { name: 'github:auth:device-code' },
  githubAuthSuccessChannel: { name: 'github:auth:success' },
  githubAuthErrorChannel: { name: 'github:auth:error' },
  githubAuthCancelledChannel: { name: 'github:auth:cancelled' },
}));

const mockExecuteOAuthFlow = vi.fn();
vi.mock('@main/core/shared/oauth-flow', () => ({
  executeOAuthFlow: (...args: unknown[]) => mockExecuteOAuthFlow(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GitHubAuthServiceImpl', () => {
  let service: GitHubAuthServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitHubAuthServiceImpl();
  });

  describe('getToken()', () => {
    it('returns token from keytar when found, skips gh CLI', async () => {
      mockGetPassword.mockResolvedValue('ghp_stored_token');

      const token = await service.getToken();

      expect(token).toBe('ghp_stored_token');
      expect(mockGetPassword).toHaveBeenCalledWith('emdash-github', 'github-token');
      expect(mockExtractGhCliToken).not.toHaveBeenCalled();
    });

    it('tries gh CLI when keytar is empty, stores in keytar, returns token', async () => {
      mockGetPassword.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockExtractGhCliToken.mockResolvedValue('gho_cli_token');
      mockSetPassword.mockResolvedValue(undefined);

      const token = await service.getToken();

      expect(token).toBe('gho_cli_token');
      expect(mockExtractGhCliToken).toHaveBeenCalled();
      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-github',
        'github-token',
        'gho_cli_token'
      );
      expect(mockSetPassword).toHaveBeenCalledWith('emdash-github', 'github-token-source', 'cli');
    });

    it('clears stale cli-managed keytar token when gh auth is logged out', async () => {
      mockGetPassword.mockResolvedValueOnce('gho_old_cli_token').mockResolvedValueOnce('cli');
      mockExtractGhCliToken.mockResolvedValue(null);
      mockDeletePassword.mockResolvedValue(true);

      const token = await service.getToken();

      expect(token).toBeNull();
      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-github', 'github-token');
      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-github', 'github-token-source');
    });

    it('returns null when nothing is found', async () => {
      mockGetPassword.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockExtractGhCliToken.mockResolvedValue(null);

      const token = await service.getToken();

      expect(token).toBeNull();
    });
  });

  describe('storeToken()', () => {
    it('stores token in keytar', async () => {
      mockSetPassword.mockResolvedValue(undefined);

      await service.storeToken('ghp_new_token');

      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-github',
        'github-token',
        'ghp_new_token'
      );
      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-github',
        'github-token-source',
        'keytar'
      );
    });
  });

  describe('logout()', () => {
    it('deletes token from keytar', async () => {
      mockDeletePassword.mockResolvedValue(true);

      await service.logout();

      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-github', 'github-token');
      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-github', 'github-token-source');
    });
  });

  describe('isAuthenticated()', () => {
    it('returns false when no token is available', async () => {
      mockGetPassword.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockExtractGhCliToken.mockResolvedValue(null);

      const result = await service.isAuthenticated();

      expect(result).toBe(false);
    });

    it('returns true when a token is available', async () => {
      mockGetPassword.mockResolvedValueOnce('ghp_some_token').mockResolvedValueOnce('keytar');

      const result = await service.isAuthenticated();

      expect(result).toBe(true);
    });
  });

  describe('startOAuthFlow()', () => {
    it('returns error when auth server is unhealthy', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));

      const result = await service.startOAuthFlow('https://auth.test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Auth server unavailable');
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
    });

    it('executes OAuth flow and stores token on success', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      mockExecuteOAuthFlow.mockResolvedValue({ accessToken: 'ghp_new' });
      mockSetPassword.mockResolvedValue(undefined);
      vi.spyOn(service, 'getUserInfo').mockResolvedValue({
        id: 1,
        login: 'testuser',
        name: 'Test',
        email: '',
        avatar_url: '',
      });

      const result = await service.startOAuthFlow('https://auth.test');

      expect(mockExecuteOAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizeUrl: 'https://auth.test/auth/github',
        })
      );
      expect(mockSetPassword).toHaveBeenCalledWith('emdash-github', 'github-token', 'ghp_new');
      expect(mockSetPassword).toHaveBeenCalledWith(
        'emdash-github',
        'github-token-source',
        'keytar'
      );
      expect(result.success).toBe(true);
      expect(result.token).toBe('ghp_new');
    });

    it('returns error when no access token in response', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      mockExecuteOAuthFlow.mockResolvedValue({ sessionToken: 'session-only' });

      const result = await service.startOAuthFlow('https://auth.test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No access token in response');
    });
  });

  describe('connect()', () => {
    it('returns existing token from keytar if valid', async () => {
      mockGetPassword.mockResolvedValueOnce('ghp_existing').mockResolvedValueOnce('keytar');
      vi.spyOn(service, 'getUserInfo').mockResolvedValue({
        id: 1,
        login: 'testuser',
        name: 'Test',
        email: '',
        avatar_url: '',
      });

      const result = await service.connect('https://auth.test', true);

      expect(result.success).toBe(true);
      expect(result.token).toBe('ghp_existing');
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
    });

    it('tries OAuth when hasAccount and no cached token', async () => {
      mockGetPassword.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockExtractGhCliToken.mockResolvedValue(null);
      mockFetch.mockResolvedValue({ ok: true });
      mockExecuteOAuthFlow.mockResolvedValue({ accessToken: 'ghp_oauth' });
      mockSetPassword.mockResolvedValue(undefined);
      vi.spyOn(service, 'getUserInfo').mockResolvedValue({
        id: 1,
        login: 'testuser',
        name: 'Test',
        email: '',
        avatar_url: '',
      });

      const result = await service.connect('https://auth.test', true);

      expect(result.success).toBe(true);
      expect(mockExecuteOAuthFlow).toHaveBeenCalled();
    });

    it('skips OAuth when hasAccount is false', async () => {
      mockGetPassword.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockExtractGhCliToken.mockResolvedValue('ghp_cli');
      mockSetPassword.mockResolvedValue(undefined);
      vi.spyOn(service, 'getUserInfo').mockResolvedValue({
        id: 1,
        login: 'testuser',
        name: 'Test',
        email: '',
        avatar_url: '',
      });

      const result = await service.connect('https://auth.test', false);

      expect(result.success).toBe(true);
      expect(result.token).toBe('ghp_cli');
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
    });

    it('falls back to gh CLI when no authServerBaseUrl', async () => {
      mockGetPassword.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockExtractGhCliToken.mockResolvedValue('ghp_cli');
      mockSetPassword.mockResolvedValue(undefined);
      vi.spyOn(service, 'getUserInfo').mockResolvedValue({
        id: 1,
        login: 'testuser',
        name: 'Test',
        email: '',
        avatar_url: '',
      });

      const result = await service.connect();

      expect(result.success).toBe(true);
      expect(result.token).toBe('ghp_cli');
      expect(mockExecuteOAuthFlow).not.toHaveBeenCalled();
    });
  });
});

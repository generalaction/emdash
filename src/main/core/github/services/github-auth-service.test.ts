import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubAuthServiceImpl } from './github-auth-service';

// Mock keytar
const mockGetPassword = vi.fn();
const mockSetPassword = vi.fn();
const mockDeletePassword = vi.fn();

vi.mock('keytar', () => ({
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

// Mock shared events
vi.mock('@shared/events/githubEvents', () => ({
  githubAuthDeviceCodeChannel: { name: 'github:auth:device-code' },
  githubAuthSuccessChannel: { name: 'github:auth:success' },
  githubAuthErrorChannel: { name: 'github:auth:error' },
  githubAuthCancelledChannel: { name: 'github:auth:cancelled' },
}));

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
      mockGetPassword.mockResolvedValue(null);
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
    });

    it('returns null when nothing is found', async () => {
      mockGetPassword.mockResolvedValue(null);
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
    });
  });

  describe('logout()', () => {
    it('deletes token from keytar', async () => {
      mockDeletePassword.mockResolvedValue(true);

      await service.logout();

      expect(mockDeletePassword).toHaveBeenCalledWith('emdash-github', 'github-token');
    });
  });

  describe('isAuthenticated()', () => {
    it('returns false when no token is available', async () => {
      mockGetPassword.mockResolvedValue(null);
      mockExtractGhCliToken.mockResolvedValue(null);

      const result = await service.isAuthenticated();

      expect(result).toBe(false);
    });

    it('returns true when a token is available', async () => {
      mockGetPassword.mockResolvedValue('ghp_some_token');

      const result = await service.isAuthenticated();

      expect(result).toBe(true);
    });
  });

  describe('startOAuthAuth()', () => {
    it('returns not available error', async () => {
      const result = await service.startOAuthAuth();

      expect(result).toEqual({ success: false, error: 'OAuth auth not available on this branch' });
    });
  });
});

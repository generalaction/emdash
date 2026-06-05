import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubAuthErrorChannel, githubAuthSuccessChannel } from '@shared/events/githubEvents';

const mocks = vi.hoisted(() => ({
  backfillLegacyToken: vi.fn(),
  emit: vi.fn(),
  listAccounts: vi.fn(),
  logError: vi.fn(),
  startDeviceFlowAuth: vi.fn(),
  telemetryCapture: vi.fn(),
}));

vi.mock('@main/core/account/config', () => ({
  ACCOUNT_CONFIG: { authServer: { baseUrl: 'http://localhost:3000' } },
}));

vi.mock('@main/core/github/accounts/github-account-backfill-instance', () => ({
  githubAccountBackfillService: {
    backfillLegacyToken: mocks.backfillLegacyToken,
  },
}));

vi.mock('@main/core/github/accounts/github-account-service-instance', () => ({
  githubAccountService: {
    listAccounts: mocks.listAccounts,
    importCliAccounts: vi.fn(),
    removeAccount: vi.fn(),
    setDefaultAccount: vi.fn(),
  },
}));

vi.mock('@main/core/github/services/github-connection-service', () => ({
  githubConnectionService: {
    startDeviceFlowAuth: mocks.startDeviceFlowAuth,
    getStatus: vi.fn(),
    startOAuthFlow: vi.fn(),
    cancelAuth: vi.fn(),
    isAuthenticated: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock('@main/core/github/services/repo-service', () => ({
  repoService: {},
}));

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {},
}));

vi.mock('@main/core/git/impl/git-repo-utils', () => ({
  cloneRepository: vi.fn(),
  initializeNewProject: vi.fn(),
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: mocks.logError,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.telemetryCapture,
  },
}));

describe('githubController auth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns the registered GitHub account and emits success after device flow registration', async () => {
    const user = {
      id: 42,
      login: 'octocat',
      name: 'Octocat',
      email: '',
      avatar_url: 'https://github.com/octocat.png',
    };
    mocks.startDeviceFlowAuth.mockResolvedValue({
      success: true,
      token: 'gho_device',
      user,
    });
    mocks.backfillLegacyToken.mockResolvedValue({ id: 'github.com:42' });
    mocks.listAccounts.mockResolvedValue([
      {
        accountId: 'github.com:42',
        host: 'github.com',
        login: 'octocat',
        avatarUrl: 'https://github.com/octocat.png',
        credentialSource: 'device_flow',
        isDefault: true,
      },
    ]);

    const { githubController } = await import('./controller');

    await expect(githubController.auth()).resolves.toEqual({
      success: true,
      account: {
        accountId: 'github.com:42',
        host: 'github.com',
        login: 'octocat',
        avatarUrl: 'https://github.com/octocat.png',
        credentialSource: 'device_flow',
        isDefault: true,
      },
    });
    expect(mocks.emit).toHaveBeenCalledWith(githubAuthSuccessChannel, {
      token: 'gho_device',
      user,
    });
    expect(mocks.telemetryCapture).toHaveBeenCalledWith('integration_connected', {
      provider: 'github',
    });
  });

  it('returns failure and does not emit success when device flow cannot register an account', async () => {
    mocks.startDeviceFlowAuth.mockResolvedValue({
      success: true,
      token: 'gho_device',
      user: {
        id: 42,
        login: 'octocat',
        name: 'Octocat',
        email: '',
        avatar_url: 'https://github.com/octocat.png',
      },
    });
    mocks.backfillLegacyToken.mockResolvedValue(null);

    const { githubController } = await import('./controller');

    await expect(githubController.auth()).resolves.toEqual({
      success: false,
      error: 'Failed to register GitHub account',
    });
    expect(mocks.emit).toHaveBeenCalledWith(githubAuthErrorChannel, {
      error: 'account_registration_failed',
      message: 'Failed to register GitHub account',
    });
    expect(mocks.telemetryCapture).not.toHaveBeenCalled();
  });

  it('reports account registration failure when registration throws after device flow succeeds', async () => {
    mocks.startDeviceFlowAuth.mockResolvedValue({
      success: true,
      token: 'gho_device',
      user: {
        id: 42,
        login: 'octocat',
        name: 'Octocat',
        email: '',
        avatar_url: 'https://github.com/octocat.png',
      },
    });
    mocks.backfillLegacyToken.mockRejectedValue(new Error('secure storage failed'));

    const { githubController } = await import('./controller');

    await expect(githubController.auth()).resolves.toEqual({
      success: false,
      error: 'Failed to register GitHub account',
    });
    expect(mocks.emit).toHaveBeenCalledWith(githubAuthErrorChannel, {
      error: 'account_registration_failed',
      message: 'Failed to register GitHub account',
    });
    expect(mocks.telemetryCapture).not.toHaveBeenCalled();
  });
});

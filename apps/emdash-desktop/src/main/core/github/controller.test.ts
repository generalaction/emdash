import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubAuthErrorChannel, githubAuthSuccessChannel } from '@shared/events/githubEvents';

const mocks = vi.hoisted(() => ({
  cloneProjectRepository: vi.fn(),
  emit: vi.fn(),
  initializeProjectRepository: vi.fn(),
  listAccounts: vi.fn(),
  logError: vi.fn(),
  startDeviceFlow: vi.fn(),
  telemetryCapture: vi.fn(),
}));

vi.mock('@main/core/github/accounts/github-account-service-instance', () => ({
  githubAccountService: {
    listAccounts: mocks.listAccounts,
    importCliAccounts: vi.fn(),
    removeAccount: vi.fn(),
    setDefaultAccount: vi.fn(),
  },
}));

vi.mock('@main/core/github/services/github-device-flow-service-instance', () => ({
  githubDeviceFlowService: {
    start: mocks.startDeviceFlow,
    cancelAuth: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock('@main/core/github/services/repo-service', () => ({
  repoService: {},
}));

vi.mock('@main/core/projects/operations/git-repository-setup', () => ({
  cloneProjectRepository: mocks.cloneProjectRepository,
  initializeProjectRepository: mocks.initializeProjectRepository,
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
    mocks.startDeviceFlow.mockResolvedValue({
      success: true,
      token: 'gho_device',
      user,
      account: { id: 'github.com:42' },
    });
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
      user,
    });
    expect(mocks.telemetryCapture).toHaveBeenCalledWith('integration_connected', {
      provider: 'github',
    });
  });

  it('returns failure and does not emit success when device flow cannot register an account', async () => {
    mocks.startDeviceFlow.mockResolvedValue({
      success: true,
      token: 'gho_device',
      user: {
        id: 42,
        login: 'octocat',
        name: 'Octocat',
        email: '',
        avatar_url: 'https://github.com/octocat.png',
      },
      account: { id: 'github.com:42' },
    });
    mocks.listAccounts.mockResolvedValue([]);

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
    mocks.startDeviceFlow.mockResolvedValue({
      success: true,
      token: 'gho_device',
      user: {
        id: 42,
        login: 'octocat',
        name: 'Octocat',
        email: '',
        avatar_url: 'https://github.com/octocat.png',
      },
      account: { id: 'github.com:42' },
    });
    mocks.listAccounts.mockRejectedValue(new Error('secure storage failed'));

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

describe('githubController git runtime operations', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('delegates repository clones to the project setup operation', async () => {
    mocks.cloneProjectRepository.mockResolvedValue({ success: true });

    const { githubController } = await import('./controller');

    await expect(
      githubController.cloneRepository('https://github.com/acme/repo.git', '/work/repo')
    ).resolves.toEqual({ success: true });
    expect(mocks.cloneProjectRepository).toHaveBeenCalledWith({
      repositoryUrl: 'https://github.com/acme/repo.git',
      targetPath: '/work/repo',
      connectionId: undefined,
    });
  });

  it('delegates project initialization to the project setup operation', async () => {
    mocks.initializeProjectRepository.mockResolvedValue({ success: true });

    const { githubController } = await import('./controller');

    await expect(
      githubController.initializeProject({
        targetPath: '/work/repo',
        name: 'Repo',
        description: 'Description',
      })
    ).resolves.toEqual({ success: true });
    expect(mocks.initializeProjectRepository).toHaveBeenCalledWith({
      targetPath: '/work/repo',
      name: 'Repo',
      description: 'Description',
    });
  });
});

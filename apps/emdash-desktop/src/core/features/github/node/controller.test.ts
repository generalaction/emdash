import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  logError: vi.fn(),
  startDeviceFlow: vi.fn(),
}));

vi.mock('@core/features/github/node', () => ({
  githubEvents: { emit: mocks.emit },
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
    const account = {
      providerId: 'github',
      displayName: '@octocat',
      accountId: 'github.com:42',
      host: 'github.com',
      login: 'octocat',
      avatarUrl: 'https://github.com/octocat.png',
      credentialSource: 'device_flow',
      isDefault: true,
    };
    mocks.startDeviceFlow.mockResolvedValue({ success: true, user, account });

    const { createGithubOperations } = await import('./controller');
    const githubController = createGithubOperations({
      cliAccountImporter: { importAccounts: vi.fn() },
      deviceFlowService: {
        start: mocks.startDeviceFlow,
        cancelAuth: vi.fn(),
        cancel: vi.fn(),
      } as never,
      logger: { error: mocks.logError } as never,
      repositoryService: {} as never,
    });

    await expect(githubController.auth()).resolves.toEqual({
      success: true,
      account: {
        providerId: 'github',
        displayName: '@octocat',
        accountId: 'github.com:42',
        host: 'github.com',
        login: 'octocat',
        avatarUrl: 'https://github.com/octocat.png',
        credentialSource: 'device_flow',
        isDefault: true,
      },
    });
    expect(mocks.emit).toHaveBeenCalledWith(undefined, {
      type: 'auth-success',
      user,
    });
  });

  it('preserves a device flow failure', async () => {
    mocks.startDeviceFlow.mockResolvedValue({
      success: false,
      error: 'Secure storage unavailable',
    });
    const { createGithubOperations } = await import('./controller');
    const operations = createGithubOperations({
      cliAccountImporter: { importAccounts: vi.fn() },
      deviceFlowService: { start: mocks.startDeviceFlow } as never,
      logger: { error: mocks.logError } as never,
      repositoryService: {} as never,
    });
    expect(await operations.auth()).toEqual({
      success: false,
      error: 'Secure storage unavailable',
    });
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

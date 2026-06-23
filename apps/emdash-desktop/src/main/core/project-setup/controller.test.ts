import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cloneProjectRepository: vi.fn(),
  initializeProjectRepository: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: mocks.logError,
  },
}));

vi.mock('./repository-setup', () => ({
  cloneProjectRepository: mocks.cloneProjectRepository,
  initializeProjectRepository: mocks.initializeProjectRepository,
}));

describe('projectSetupController repository setup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('delegates repository clones to the project setup operation', async () => {
    mocks.cloneProjectRepository.mockResolvedValue({ success: true });

    const { projectSetupController } = await import('./controller');

    await expect(
      projectSetupController.cloneRepository('https://github.com/acme/repo.git', '/work/repo')
    ).resolves.toEqual({ success: true });
    expect(mocks.cloneProjectRepository).toHaveBeenCalledWith({
      repositoryUrl: 'https://github.com/acme/repo.git',
      targetPath: '/work/repo',
      connectionId: undefined,
    });
  });

  it('delegates repository initialization to the project setup operation', async () => {
    mocks.initializeProjectRepository.mockResolvedValue({ success: true });

    const { projectSetupController } = await import('./controller');

    await expect(
      projectSetupController.initializeRepository({
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

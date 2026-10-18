import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitLabRepositoryService } from './gitlab-repository-service';

const mocks = vi.hoisted(() => ({
  listOwners: vi.fn(),
  createRepository: vi.fn(),
  deleteRepository: vi.fn(),
}));

vi.mock('@emdash/plugins/repository', () => ({
  repositoryPluginRegistry: {
    get: () => ({ behavior: { repository: mocks } }),
  },
}));

describe('GitLab repository service', () => {
  const readCredentials = vi.fn();
  const listAccounts = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listAccounts.mockResolvedValue([
      { providerId: 'gitlab', accountId: 'selected', host: 'gitlab.example.com' },
    ]);
    readCredentials.mockResolvedValue(
      ok({ instanceUrl: 'https://gitlab.example.com', apiToken: 'secret' })
    );
    mocks.listOwners.mockResolvedValue(
      ok([{ login: 'parent/nested', type: 'Organization', avatarUrl: '' }])
    );
    mocks.createRepository.mockResolvedValue(
      ok({
        repositoryUrl: 'https://gitlab.example.com/parent/nested/repo',
        cloneUrl: 'git@gitlab.example.com:parent/nested/repo.git',
        nameWithOwner: 'parent/nested/repo',
        defaultBranch: 'main',
      })
    );
    mocks.deleteRepository.mockResolvedValue(ok());
  });

  it('uses the selected account and nested group for all operations', async () => {
    const service = createGitLabRepositoryService({ listAccounts, readCredentials });
    expect(await service.getOwners('selected')).toMatchObject({
      success: true,
      data: [{ login: 'parent/nested' }],
    });
    expect(
      await service.createRepository({
        accountId: 'selected',
        owner: 'parent/nested',
        name: 'repo',
        isPrivate: true,
      })
    ).toMatchObject({ success: true, data: { nameWithOwner: 'parent/nested/repo' } });
    await service.deleteRepository({ accountId: 'selected', owner: 'parent/nested', name: 'repo' });
    expect(readCredentials).toHaveBeenCalledWith('gitlab', 'selected', 'gitlab.example.com');
    expect(mocks.createRepository).toHaveBeenCalledWith(expect.anything(), {
      owner: 'parent/nested',
      name: 'repo',
      visibility: 'private',
    });
    expect(mocks.deleteRepository).toHaveBeenCalledWith(expect.anything(), {
      owner: 'parent/nested',
      name: 'repo',
    });
  });

  it('fails closed when the selected account is removed or its credentials cannot be read', async () => {
    const service = createGitLabRepositoryService({ listAccounts, readCredentials });
    await expect(service.getOwners('removed')).rejects.toThrow('unavailable');
    expect(readCredentials).not.toHaveBeenCalled();
    readCredentials.mockResolvedValueOnce(
      err({ type: 'account_host_mismatch', message: 'Wrong host' })
    );
    await expect(service.getOwners('selected')).rejects.toThrow('Wrong host');
    expect(mocks.listOwners).not.toHaveBeenCalled();
  });

  it('rejects credentials for another GitLab instance', async () => {
    const service = createGitLabRepositoryService({ listAccounts, readCredentials });
    readCredentials.mockResolvedValueOnce(
      ok({ instanceUrl: 'https://other.example.com', apiToken: 'secret' })
    );
    await expect(service.getOwners('selected')).rejects.toThrow('does not match');
    expect(mocks.listOwners).not.toHaveBeenCalled();
  });
});

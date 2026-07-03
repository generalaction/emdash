import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSettings } from '@shared/core/project-settings/project-settings';
import { GITHUB_PROVIDER_ID, upsertGitHubAccount } from '../accounts/github-accounts';
import { ProjectGitHubAccountBackfillService } from './project-github-account-backfill';

class FakeProjectSettings {
  settings: ProjectSettings = {};

  get = vi.fn(async () => this.settings);
  patch = vi.fn(async (patch: { githubAccountId?: string | null }) => {
    this.settings = { ...this.settings, ...patch };
    return { success: true as const, data: undefined };
  });
}

function makeProject({
  settings,
  selectedRemoteUrl = 'https://github.com/acme/repo',
}: {
  settings?: ProjectSettings;
  selectedRemoteUrl?: string | null;
} = {}) {
  const projectSettings = new FakeProjectSettings();
  if (settings) projectSettings.settings = settings;
  return {
    project: {
      projectId: 'project-1',
      settings: projectSettings,
      getRemoteState: vi.fn(async () => ({
        hasRemote: selectedRemoteUrl !== null,
        selectedRemoteUrl,
      })),
    },
    settings: projectSettings,
  };
}

describe('ProjectGitHubAccountBackfillService', () => {
  let fixture: RegistryFixture;
  let service: ProjectGitHubAccountBackfillService;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    service = new ProjectGitHubAccountBackfillService(fixture.registry);
  });

  afterEach(() => {
    fixture?.close();
  });

  async function upsertAccount(providerAccountId: string, host = 'github.com') {
    return (
      await upsertGitHubAccount(fixture.registry, {
        accessToken: `token-${host}-${providerAccountId}`,
        credentialSource: 'cli',
        providerAccount: {
          providerId: 'github',
          providerAccountId,
          host,
          login: `user-${providerAccountId}`,
          avatarUrl: '',
        },
      })
    ).account;
  }

  it('backfills GitHub.com projects without a selected account to the default account', async () => {
    await upsertAccount('42');
    const { project, settings } = makeProject();

    await expect(service.backfillProject(project)).resolves.toEqual({
      status: 'updated',
      accountId: 'github.com:42',
    });

    expect(settings.patch).toHaveBeenCalledWith({ githubAccountId: 'github.com:42' });
  });

  it('does not override an existing project GitHub account selection', async () => {
    await upsertAccount('42');
    const { project, settings } = makeProject({
      settings: { githubAccountId: 'github.com:84' },
    });

    await expect(service.backfillProject(project)).resolves.toEqual({ status: 'skipped' });

    expect(settings.patch).not.toHaveBeenCalled();
  });

  it('backfills GitHub Enterprise projects to an account on the same host', async () => {
    await upsertAccount('42');
    await upsertAccount('168', 'ghe.example.com');
    const { project, settings } = makeProject({
      selectedRemoteUrl: 'https://ghe.example.com/acme/repo',
    });

    await expect(service.backfillProject(project)).resolves.toEqual({
      status: 'updated',
      accountId: 'ghe.example.com:168',
    });

    expect(settings.patch).toHaveBeenCalledWith({ githubAccountId: 'ghe.example.com:168' });
  });

  it('uses the default account when it belongs to the project remote host', async () => {
    await upsertAccount('168', 'ghe.example.com');
    await upsertAccount('252', 'ghe.example.com');
    await upsertAccount('42');
    await fixture.registry.setDefaultAccount(GITHUB_PROVIDER_ID, 'ghe.example.com:252');
    const { project, settings } = makeProject({
      selectedRemoteUrl: 'https://ghe.example.com/acme/repo',
    });

    await expect(service.backfillProject(project)).resolves.toEqual({
      status: 'updated',
      accountId: 'ghe.example.com:252',
    });

    expect(settings.patch).toHaveBeenCalledWith({ githubAccountId: 'ghe.example.com:252' });
  });

  it('uses the oldest host account when the default is on a different host', async () => {
    await upsertAccount('42'); // github.com default
    await upsertAccount('168', 'ghe.example.com');
    await upsertAccount('252', 'ghe.example.com');
    const { project, settings } = makeProject({
      selectedRemoteUrl: 'https://ghe.example.com/acme/repo',
    });

    await expect(service.backfillProject(project)).resolves.toEqual({
      status: 'updated',
      accountId: 'ghe.example.com:168',
    });

    expect(settings.patch).toHaveBeenCalledWith({ githubAccountId: 'ghe.example.com:168' });
  });

  it('does not backfill projects when no account exists for the remote host', async () => {
    await upsertAccount('42');
    const { project, settings } = makeProject({
      selectedRemoteUrl: 'https://ghe.example.com/acme/repo',
    });

    await expect(service.backfillProject(project)).resolves.toEqual({ status: 'skipped' });

    expect(settings.patch).not.toHaveBeenCalled();
  });

  it('leaves projects unconfigured when no accounts exist', async () => {
    const { project, settings } = makeProject();

    await expect(service.backfillProject(project)).resolves.toEqual({ status: 'skipped' });

    expect(settings.patch).not.toHaveBeenCalled();
  });
});

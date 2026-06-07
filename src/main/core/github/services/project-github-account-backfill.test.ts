import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSettings } from '@shared/project-settings';
import type { GitHubAccount } from '../accounts/github-account-registry';
import { ProjectGitHubAccountBackfillService } from './project-github-account-backfill';

function account(id: string, host = id.split(':')[0]): GitHubAccount {
  return {
    id,
    providerAccountId: id.split(':')[1] ?? id,
    host,
    login: id,
    avatarUrl: '',
    credentialSource: 'cli',
    connectedAt: 1,
    updatedAt: 1,
  };
}

class AccountLookup {
  defaultAccountId: string | null = 'github.com:42';
  accounts: GitHubAccount[] = [account('github.com:42')];

  getDefaultAccountId = vi.fn(async () => this.defaultAccountId);
  listAccounts = vi.fn(async () => this.accounts);
}

class FakeProjectSettings {
  settings: ProjectSettings = {};

  get = vi.fn(async () => this.settings);
  update = vi.fn(async (settings: ProjectSettings) => {
    this.settings = settings;
    return { success: true as const, data: undefined };
  });
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
  let accountLookup: AccountLookup;
  let service: ProjectGitHubAccountBackfillService;

  beforeEach(() => {
    accountLookup = new AccountLookup();
    service = new ProjectGitHubAccountBackfillService(accountLookup);
  });

  it('backfills GitHub.com projects without a selected account to the default account', async () => {
    const { project, settings } = makeProject();

    await expect(service.backfillProject(project)).resolves.toEqual({
      status: 'updated',
      accountId: 'github.com:42',
    });

    expect(settings.patch).toHaveBeenCalledWith({ githubAccountId: 'github.com:42' });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('does not override an existing project GitHub account selection', async () => {
    const { project, settings } = makeProject({
      settings: { githubAccountId: 'github.com:84' },
    });

    await expect(service.backfillProject(project)).resolves.toEqual({ status: 'skipped' });

    expect(settings.update).not.toHaveBeenCalled();
  });

  it('backfills GitHub Enterprise projects to an account on the same host', async () => {
    accountLookup.accounts = [account('github.com:42'), account('ghe.example.com:168')];
    const { project, settings } = makeProject({
      selectedRemoteUrl: 'https://ghe.example.com/acme/repo',
    });

    await expect(service.backfillProject(project)).resolves.toEqual({
      status: 'updated',
      accountId: 'ghe.example.com:168',
    });

    expect(settings.patch).toHaveBeenCalledWith({ githubAccountId: 'ghe.example.com:168' });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('uses the default account when it belongs to the project remote host', async () => {
    accountLookup.defaultAccountId = 'ghe.example.com:252';
    accountLookup.accounts = [
      account('ghe.example.com:168'),
      account('ghe.example.com:252'),
      account('github.com:42'),
    ];
    const { project, settings } = makeProject({
      selectedRemoteUrl: 'https://ghe.example.com/acme/repo',
    });

    await expect(service.backfillProject(project)).resolves.toEqual({
      status: 'updated',
      accountId: 'ghe.example.com:252',
    });

    expect(settings.patch).toHaveBeenCalledWith({ githubAccountId: 'ghe.example.com:252' });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('uses the oldest account for the project remote host when no default is set', async () => {
    accountLookup.defaultAccountId = null;
    accountLookup.accounts = [
      { ...account('github.com:84'), connectedAt: 2 },
      { ...account('github.com:42'), connectedAt: 1 },
    ];
    const { project, settings } = makeProject();

    await expect(service.backfillProject(project)).resolves.toEqual({
      status: 'updated',
      accountId: 'github.com:42',
    });

    expect(settings.patch).toHaveBeenCalledWith({ githubAccountId: 'github.com:42' });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('does not backfill projects when no account exists for the remote host', async () => {
    accountLookup.accounts = [account('github.com:42')];
    const { project, settings } = makeProject({
      selectedRemoteUrl: 'https://ghe.example.com/acme/repo',
    });

    await expect(service.backfillProject(project)).resolves.toEqual({ status: 'skipped' });

    expect(settings.update).not.toHaveBeenCalled();
  });

  it('leaves projects unconfigured when no default account exists', async () => {
    accountLookup.defaultAccountId = null;
    accountLookup.accounts = [];
    const { project, settings } = makeProject();

    await expect(service.backfillProject(project)).resolves.toEqual({ status: 'skipped' });

    expect(settings.update).not.toHaveBeenCalled();
  });
});

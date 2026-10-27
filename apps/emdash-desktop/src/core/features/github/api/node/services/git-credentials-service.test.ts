import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { Logger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type { AgentGitCredentialsSetting, Resolved } from '@core/primitives/project-settings/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { createGitCredentialsService } from './git-credentials-service';

const account: GitHubAccountSummary = {
  providerId: 'github',
  displayName: '@octocat',
  accountId: 'account-1',
  host: 'GitHub.com',
  login: 'octocat',
  avatarUrl: 'https://example.invalid/a.png',
  credentialSource: 'emdash_oauth',
  isDefault: true,
};

const REMOTE_HOST = hostRef('remote', 'ssh-1');

function makeService(
  options: {
    setting?: AgentGitCredentialsSetting;
    resolution?: Resolved<GitHubAccountSummary | null>;
    accounts?: ProviderAccountSummary[];
  } = {}
) {
  const mintSession = vi.fn(async () => ({ port: 45678, nonce: 'nonce-1' }));
  const revokeSession = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = createGitCredentialsService({
    getAgentGitCredentialsSetting: async () => options.setting ?? 'effective-account',
    resolveProjectIntegrationAccount: async () => ({
      ...(options.resolution ?? { value: account, provenance: { kind: 'set' as const } }),
      accounts: options.accounts ?? [account],
      contextKey: '',
    }),
    listAccounts: async () => options.accounts ?? [account],
    channels: { mintSession, revokeSession },
    logger: logger as unknown as Logger,
  });
  return { service, mintSession, revokeSession, logger };
}

describe('resolveSessionSpec', () => {
  it('uses the GitLab account for a GitLab project', async () => {
    const gitlab = {
      providerId: 'gitlab',
      accountId: 'gl-1',
      host: 'gitlab.com',
      displayName: '@user',
      isDefault: true,
    };
    const mintSession = vi.fn(async () => ({ port: 45678, nonce: 'gitlab-nonce' }));
    const service = createGitCredentialsService({
      getAgentGitCredentialsSetting: async () => 'effective-account',
      resolveProjectIntegrationAccount: async (_projectId, providerId) => ({
        value: providerId === 'gitlab' ? gitlab : null,
        provenance: { kind: 'inferred', from: 'repository host' },
        accounts: providerId === 'gitlab' ? [gitlab] : [],
        contextKey: '',
      }),
      listAccounts: async () => [gitlab],
      channels: { mintSession, revokeSession: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
    });
    expect(await service.resolveSessionSpec({ projectId: 'p1', host: LOCAL_HOST_REF })).toEqual({
      mode: 'effective-account',
      channel: { port: 45678, nonce: 'gitlab-nonce' },
      hosts: ['gitlab.com'],
    });
    expect(mintSession).toHaveBeenCalledWith({
      kind: 'project',
      projectId: 'p1',
      providerId: 'gitlab',
    });
  });
  it('maps the effective-account setting to a channel-backed spec with the account host', async () => {
    const { service, mintSession } = makeService();
    const spec = await service.resolveSessionSpec({ projectId: 'p1', host: LOCAL_HOST_REF });
    expect(spec).toEqual({
      mode: 'effective-account',
      channel: { port: 45678, nonce: 'nonce-1' },
      hosts: ['github.com'],
    });
    expect(mintSession).toHaveBeenCalledWith({
      kind: 'project',
      projectId: 'p1',
      providerId: 'github',
    });
  });

  it('maps system and none settings without minting a channel', async () => {
    const system = makeService({ setting: 'system' });
    await expect(
      system.service.resolveSessionSpec({ projectId: 'p1', host: LOCAL_HOST_REF })
    ).resolves.toEqual({ mode: 'system' });
    expect(system.mintSession).not.toHaveBeenCalled();

    const none = makeService({ setting: 'none' });
    await expect(
      none.service.resolveSessionSpec({ projectId: 'p1', host: REMOTE_HOST })
    ).resolves.toEqual({ mode: 'none' });
    expect(none.mintSession).not.toHaveBeenCalled();
  });

  it('skips the helper on remote hosts (loopback unreachable)', async () => {
    const { service, mintSession } = makeService();
    await expect(
      service.resolveSessionSpec({ projectId: 'p1', host: REMOTE_HOST })
    ).resolves.toBeUndefined();
    expect(mintSession).not.toHaveBeenCalled();
  });

  it('fails closed to native behavior on an unresolvable account pin', async () => {
    const { service, mintSession, logger } = makeService({
      resolution: { value: null, provenance: { kind: 'unresolvable' } },
    });
    await expect(
      service.resolveSessionSpec({ projectId: 'p1', host: LOCAL_HOST_REF })
    ).resolves.toBeUndefined();
    expect(mintSession).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('mintOperationCredentials', () => {
  it('leases a project-scoped channel and revokes it on release', async () => {
    const { service, revokeSession } = makeService();
    const lease = await service.mintOperationCredentials({ projectId: 'p1', host: LOCAL_HOST_REF });
    expect(lease?.credentials).toEqual({ port: 45678, nonce: 'nonce-1', host: 'github.com' });
    lease?.release();
    expect(revokeSession).toHaveBeenCalledWith('nonce-1');
  });

  it('returns nothing on remote hosts or when no account resolves', async () => {
    const remote = makeService();
    await expect(
      remote.service.mintOperationCredentials({ projectId: 'p1', host: REMOTE_HOST })
    ).resolves.toBeUndefined();

    const noAccount = makeService({
      resolution: { value: null, provenance: { kind: 'inferred', from: 'none' } },
    });
    await expect(
      noAccount.service.mintOperationCredentials({ projectId: 'p1', host: LOCAL_HOST_REF })
    ).resolves.toBeUndefined();
  });

  it('leases the selected account instead of the project account', async () => {
    const selected = { ...account, accountId: 'selected-work', isDefault: false };
    const { service, mintSession, revokeSession } = makeService({ accounts: [account, selected] });
    const lease = await service.mintOperationCredentials({
      projectId: 'p1',
      host: LOCAL_HOST_REF,
      account: { providerId: 'github', accountId: 'selected-work' },
    });
    expect(mintSession).toHaveBeenCalledWith({
      kind: 'account',
      providerId: 'github',
      accountId: 'selected-work',
      host: 'github.com',
    });
    lease?.release();
    expect(revokeSession).toHaveBeenCalledWith('nonce-1');
  });

  it('rejects a removed selected account without minting credentials', async () => {
    const { service, mintSession } = makeService();
    await expect(
      service.mintOperationCredentials({
        projectId: 'p1',
        host: LOCAL_HOST_REF,
        account: { providerId: 'github', accountId: 'removed' },
      })
    ).rejects.toThrow('selected Git account is unavailable');
    expect(mintSession).not.toHaveBeenCalled();
  });
});

describe('mintCloneCredentials', () => {
  it.each([
    ['https://gitlab.com/parent/nested/repo.git', 'gitlab.com'],
    ['https://gitlab.example.com/gitlab/parent/nested/repo.git', 'gitlab.example.com'],
  ])('infers a GitLab account for %s', async (repositoryUrl, host) => {
    const gitlab = {
      providerId: 'gitlab',
      accountId: 'gl-1',
      host,
      displayName: '@user',
      isDefault: true,
    };
    const { service, mintSession } = makeService({ accounts: [gitlab] });
    await service.mintCloneCredentials({ repositoryUrl, host: LOCAL_HOST_REF });
    expect(mintSession).toHaveBeenCalledWith({
      kind: 'account',
      providerId: 'gitlab',
      accountId: 'gl-1',
      host,
    });
  });

  it('refuses an ambiguous self-hosted clone account', async () => {
    const accounts = [
      { ...account, accountId: 'gh-enterprise', host: 'code.example.com' },
      {
        providerId: 'gitlab',
        accountId: 'gl-1',
        host: 'code.example.com',
        displayName: '@user',
        isDefault: true,
      },
    ];
    const { service, mintSession } = makeService({ accounts });
    await expect(
      service.mintCloneCredentials({
        repositoryUrl: 'https://code.example.com/group/repo.git',
        host: LOCAL_HOST_REF,
      })
    ).rejects.toThrow('More than one');
    expect(mintSession).not.toHaveBeenCalled();
  });
  it('leases the selected GitLab account for an HTTPS clone', async () => {
    const gitlab = {
      providerId: 'gitlab',
      accountId: 'gl-1',
      host: 'gitlab.com',
      displayName: '@user',
      isDefault: true,
    };
    const mintSession = vi.fn(async () => ({ port: 45678, nonce: 'gitlab-nonce' }));
    const service = createGitCredentialsService({
      getAgentGitCredentialsSetting: async () => 'effective-account',
      resolveProjectIntegrationAccount: async () => ({
        value: null,
        provenance: { kind: 'inferred', from: 'default account' },
        accounts: [],
        contextKey: '',
      }),
      listAccounts: async (providerId) => (providerId === 'gitlab' ? [gitlab] : []),
      channels: { mintSession, revokeSession: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
    });
    await service.mintCloneCredentials({
      repositoryUrl: 'https://gitlab.com/parent/nested/repo.git',
      host: LOCAL_HOST_REF,
      account: { providerId: 'gitlab', accountId: 'gl-1' },
    });
    expect(mintSession).toHaveBeenCalledWith({
      kind: 'account',
      providerId: 'gitlab',
      accountId: 'gl-1',
      host: 'gitlab.com',
    });
  });
  it('retains an explicit non-default account instead of choosing the host default', async () => {
    const selected = { ...account, accountId: 'selected-work', isDefault: false };
    const { service, mintSession } = makeService({ accounts: [account, selected] });
    await service.mintCloneCredentials({
      repositoryUrl: 'https://github.com/org/private-repo.git',
      host: LOCAL_HOST_REF,
      account: { providerId: 'github', accountId: selected.accountId },
    });
    expect(mintSession).toHaveBeenCalledExactlyOnceWith({
      kind: 'account',
      accountId: 'selected-work',
      host: 'github.com',
      providerId: 'github',
    });
  });

  it.each([
    { providerId: 'github', accountId: 'missing' },
    { providerId: 'gitlab', accountId: 'account-1' },
  ])('does not fall back from an unavailable explicit clone account %j', async (selected) => {
    const { service, mintSession } = makeService();
    await expect(
      service.mintCloneCredentials({
        repositoryUrl: 'https://github.com/org/private-repo.git',
        host: LOCAL_HOST_REF,
        account: selected,
      })
    ).rejects.toThrow();
    expect(mintSession).not.toHaveBeenCalled();
  });

  it('rejects an explicit account on another host before cloning', async () => {
    const { service, mintSession } = makeService();
    await expect(
      service.mintCloneCredentials({
        repositoryUrl: 'https://enterprise.example/org/repo.git',
        host: LOCAL_HOST_REF,
        account: { providerId: 'github', accountId: account.accountId },
      })
    ).rejects.toThrow('does not match');
    expect(mintSession).not.toHaveBeenCalled();
  });
  it('leases an account-scoped channel for an https URL with a matching account', async () => {
    const { service, mintSession, revokeSession } = makeService();
    const lease = await service.mintCloneCredentials({
      repositoryUrl: 'https://github.com/org/repo.git',
      host: LOCAL_HOST_REF,
    });
    expect(lease?.credentials).toEqual({ port: 45678, nonce: 'nonce-1', host: 'github.com' });
    expect(mintSession).toHaveBeenCalledWith({
      kind: 'account',
      accountId: 'account-1',
      host: 'github.com',
      providerId: 'github',
    });
    lease?.release();
    expect(revokeSession).toHaveBeenCalledWith('nonce-1');
  });

  it('leaves ssh clones and unmatched hosts on native behavior', async () => {
    const { service, mintSession } = makeService();
    await expect(
      service.mintCloneCredentials({
        repositoryUrl: 'git@github.com:org/repo.git',
        host: LOCAL_HOST_REF,
      })
    ).resolves.toBeUndefined();
    await expect(
      service.mintCloneCredentials({
        repositoryUrl: 'https://gitlab.example.com/org/repo.git',
        host: LOCAL_HOST_REF,
      })
    ).resolves.toBeUndefined();
    expect(mintSession).not.toHaveBeenCalled();
  });
});

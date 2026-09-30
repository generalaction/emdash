import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredIntegrationAccounts } from '@core/primitives/project-settings/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { useProjectAccount } from './use-project-account';

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  settings: vi.fn(),
  repository: vi.fn(),
}));
vi.mock('./use-provider-accounts', () => ({ useAccounts: mocks.accounts }));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: mocks.settings,
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: mocks.repository,
}));

const account: ProviderAccountSummary = {
  providerId: 'gitlab',
  accountId: 'work',
  host: 'gitlab.example',
  displayName: 'Work',
  isDefault: true,
};
function settings(stored: StoredIntegrationAccounts = {}) {
  return { durableDomains: { integrationAccounts: { stored }, gitIdentity: { stored: {} } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accounts.mockReturnValue({ data: [account] });
  mocks.settings.mockReturnValue(settings());
  mocks.repository.mockReturnValue({
    loading: false,
    repoFacts: {
      remotes: [{ name: 'origin', host: 'gitlab.example', headBranch: null, branches: [] }],
      localBranches: [],
    },
  });
});

describe('useProjectAccount', () => {
  it('resolves from durable account and Git inputs without placement settings', () => {
    const result = useProjectAccount('project-1', 'gitlab', { repository: { kind: 'project' } });
    expect(result?.value).toEqual(account);
    expect(result?.accounts).toEqual([account]);
    expect(mocks.accounts).toHaveBeenCalledWith('gitlab');
  });

  it.each(['pending', 'error'])(
    'does not infer while account inventory is unavailable (%s)',
    (status) => {
      mocks.accounts.mockReturnValue({ data: undefined, status });
      expect(
        useProjectAccount('project-1', 'gitlab', { repository: { kind: 'project' } })
      ).toBeNull();
    }
  );

  it('does not infer while project settings or repository facts are loading', () => {
    mocks.settings.mockReturnValue({ durableDomains: null });
    expect(useProjectAccount('project-1', 'gitlab')).toBeNull();
    mocks.settings.mockReturnValue(settings());
    mocks.repository.mockReturnValue({ loading: true });
    expect(
      useProjectAccount('project-1', 'gitlab', { repository: { kind: 'project' } })
    ).toBeNull();
  });

  it('preserves a durable pin when repository facts cannot be loaded', () => {
    mocks.settings.mockReturnValue(settings({ gitlab: { kind: 'account', accountId: 'work' } }));
    mocks.repository.mockReturnValue({ loading: false, repoFacts: null });
    expect(
      useProjectAccount('project-1', 'gitlab', { repository: { kind: 'project' } })
    ).toMatchObject({ value: account, provenance: { kind: 'set' } });
  });

  it('uses an explicit repository URL without waiting for the project repository', () => {
    mocks.repository.mockReturnValue({ loading: true });
    expect(
      useProjectAccount('project-1', 'gitlab', {
        repository: { kind: 'url', url: 'git@gitlab.example:team/repo.git' },
      })?.value
    ).toEqual(account);
    expect(mocks.repository).not.toHaveBeenCalled();
  });

  it('fails closed when a provider-specific type guard excludes the pinned account', () => {
    mocks.settings.mockReturnValue(settings({ gitlab: { kind: 'account', accountId: 'work' } }));
    const result = useProjectAccount('project-1', 'gitlab', {
      accepts: (value): value is ProviderAccountSummary & { login: string } =>
        typeof value.login === 'string',
    });
    expect(result).toMatchObject({
      value: null,
      provenance: { kind: 'unresolvable' },
      accounts: [],
    });
  });
});

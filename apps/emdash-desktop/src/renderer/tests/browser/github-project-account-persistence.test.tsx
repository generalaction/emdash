import '@emdash/ui/style.css';
import { deferred } from '@emdash/shared/testing';
import { Dialog } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { CreatePrModal } from '@core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/create-pr-modal';
import { AddRemoteModal } from '@core/features/tasks/browser/add-remote-modal';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import { ModalHostTestProvider, type ModalHostController } from '@core/primitives/modals/react';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  settingsAvailable: true,
  savedAccountId: 'personal',
  createPullRequest: vi.fn(),
  createRepository: vi.fn(),
  createGitlabRepository: vi.fn(),
}));

function account(accountId: string): GitHubAccountSummary {
  return {
    providerId: 'github',
    accountId,
    displayName: `@${accountId}`,
    host: 'github.com',
    login: accountId,
    avatarUrl: '',
    credentialSource: 'cli',
    isDefault: accountId === 'personal',
  };
}
const personal = account('personal');
const work = account('work');
const gitlabAccount = {
  providerId: 'gitlab',
  accountId: 'gitlab-work',
  displayName: '@gitlab-work',
  host: 'gitlab.com',
  login: 'gitlab-work',
  isDefault: true,
};
const repositoryUrl = 'https://github.com/acme/repo';
const remote = { name: 'origin', url: repositoryUrl };
const baseBranch = { type: 'remote', branch: 'main', remote };
const repository = {
  remotes: [remote],
  baseRemote: remote,
  pushRemote: remote,
  branchRefs: [baseBranch],
  defaultBranchRef: baseBranch,
  effectiveGitSettings: {
    baseRemote: { value: 'origin', provenance: { kind: 'inferred', from: 'origin remote' } },
    pushRemote: { value: 'origin', provenance: { kind: 'inferred', from: 'base remote' } },
  },
  addRemote: vi.fn(),
  fetchRemote: vi.fn(),
  refreshLocal: vi.fn(),
  refreshRemote: vi.fn(),
};
const checkout = { isPublished: true, aheadCount: 0, publishCurrentBranch: vi.fn() };

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: () => (mocks.settingsAvailable ? { save: mocks.save } : undefined),
}));
vi.mock('@core/features/integrations/api/browser/use-project-account', () => ({
  useProjectAccount: (_projectId: string, providerId: string) => ({
    value: providerId === 'gitlab' ? gitlabAccount : personal,
    provenance: { kind: 'set' },
  }),
}));
vi.mock('@core/features/integrations/api/browser/use-provider-accounts', () => ({
  useAccounts: (providerId: string) => ({
    data: providerId === 'gitlab' ? [gitlabAccount] : [personal, work],
  }),
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => repository,
  getGitCheckoutStore: () => checkout,
}));
vi.mock('@core/features/workspaces/api/browser/stores/workspace-registry', () => ({
  workspaceRegistry: { get: () => ({ get: () => checkout }) },
}));
vi.mock('@core/services/pull-requests/api/client', () => ({
  getPullRequestsRuntimeClient: async () => ({ createPullRequest: mocks.createPullRequest }),
}));
vi.mock('@core/features/github/api/browser/client', () => ({
  getGithubClient: async () => ({ createRepository: mocks.createRepository }),
}));
vi.mock('@core/features/repository/api/client', () => ({
  getRepositoryClient: async () => ({ gitLabCreate: mocks.createGitlabRepository }),
}));
vi.mock('@core/features/repository/api/browser/use-repository-owner-select', () => ({
  useRepositoryOwnerSelect: (providerId: string) => ({
    owners: [
      {
        value: providerId === 'gitlab' ? 'parent/nested' : 'acme',
        label: providerId === 'gitlab' ? 'parent/nested' : 'acme',
      },
    ],
    owner: {
      value: providerId === 'gitlab' ? 'parent/nested' : 'acme',
      label: providerId === 'gitlab' ? 'parent/nested' : 'acme',
    },
    isLoading: false,
    errorMessage: null,
    handleOwnerChange: vi.fn(),
  }),
}));
vi.mock('@core/features/github/api/browser/useGithubRepositoryOwners', () => ({
  useGitHubRepositoryOwnerSelect: () => ({
    owners: [{ value: 'acme', label: 'acme' }],
    owner: { value: 'acme', label: 'acme' },
    isLoading: false,
    errorMessage: null,
    handleOwnerChange: vi.fn(),
  }),
}));
vi.mock('@core/features/source-control/contributions/browser/project-branch-selector', () => ({
  ProjectBranchSelector: () => null,
}));
vi.mock('@core/features/source-control/contributions/browser/branch-display', () => ({
  BranchDisplay: () => null,
}));
vi.mock('@core/features/source-control/contributions/browser/remote-selector', () => ({
  RemoteSelector: () => null,
}));
vi.mock('@core/primitives/keybindings/browser/confirm-button', async () => {
  const { Button } = await import('@emdash/ui/react/primitives');
  return { ConfirmButton: Button };
});

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('project account persistence in GitHub actions', () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: ModalHostController;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsAvailable = true;
    mocks.savedAccountId = 'personal';
    mocks.save.mockResolvedValue({ success: true, data: {} });
    mocks.createPullRequest.mockResolvedValue({ success: true });
    // Stop after observing account selection, without exercising unrelated Git operations.
    mocks.createRepository.mockResolvedValue({
      success: false,
      error: 'Repository fixture stopped',
    });
    mocks.createGitlabRepository.mockResolvedValue({
      success: false,
      error: 'Repository fixture stopped',
    });
    repository.addRemote.mockResolvedValue({ success: true });
    repository.fetchRemote.mockResolvedValue({ success: true });
    checkout.publishCurrentBranch.mockResolvedValue({ success: true });
    controller = {
      complete: vi.fn(),
      dismiss: vi.fn(),
      setCloseGuard: vi.fn(),
      hasActiveCloseGuard: false,
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(kind: 'pr' | 'remote') {
    await act(async () => {
      root.render(
        <Dialog.Root open>
          <Dialog.Content size="md">
            <ModalHostTestProvider
              id={kind === 'pr' ? 'createPrModal' : 'addRemoteModal'}
              controller={controller}
            >
              {kind === 'pr' ? (
                <CreatePrModal
                  projectId="project-1"
                  taskId="task-1"
                  workspaceId="workspace-1"
                  repositoryUrl={repositoryUrl}
                  branchName="feature"
                  draft={false}
                />
              ) : (
                <AddRemoteModal
                  projectId="project-1"
                  projectName="repo"
                  workspaceId="workspace-1"
                />
              )}
            </ModalHostTestProvider>
          </Dialog.Content>
        </Dialog.Root>
      );
    });
  }

  function button(text: string, scope: ParentNode = document): HTMLButtonElement {
    const found = [...scope.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(text)
    );
    if (!found) throw new Error(`Missing button: ${text}`);
    return found;
  }

  async function chooseWork(remember = false) {
    await act(async () => button('Change').click());
    const popup = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    if (!popup) throw new Error('Account picker did not open');
    if (remember) {
      const checkbox = popup.querySelector<HTMLElement>('[data-slot="checkbox"]');
      if (!checkbox) throw new Error('Remember checkbox missing');
      await act(async () => checkbox.click());
    }
    await act(async () => button('@work', popup).click());
  }

  it('blocks PR submission and account changes until the project selection is saved', async () => {
    const gate = deferred<void>();
    mocks.save.mockImplementation(async () => {
      await gate.promise;
      mocks.savedAccountId = 'work';
      return { success: true, data: {} };
    });
    const usedAccounts: string[] = [];
    mocks.createPullRequest.mockImplementation(async () => {
      usedAccounts.push(mocks.savedAccountId);
      return { success: true };
    });
    await render('pr');
    await chooseWork();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      integrationAccounts: { stored: { github: { kind: 'account', accountId: 'work' } } },
    });
    expect(button('Create PR').disabled).toBe(true);
    expect(button('Change').disabled).toBe(true);
    await act(async () => button('Create PR').click());
    expect(mocks.createPullRequest).not.toHaveBeenCalled();

    await act(async () => gate.resolve());
    expect(button('Create PR').disabled).toBe(false);
    await act(async () => button('Create PR').click());
    expect(usedAccounts).toEqual(['work']);
  });

  it.each(['reported failure', 'rejected request', 'unavailable settings'])(
    'keeps PR submission blocked after %s and permits retry',
    async (failure) => {
      if (failure === 'reported failure')
        mocks.save.mockResolvedValueOnce({ success: false, error: { type: 'save_failed' } });
      if (failure === 'rejected request')
        mocks.save.mockRejectedValueOnce(new Error('Wire disconnected'));
      if (failure === 'unavailable settings') mocks.settingsAvailable = false;
      await render('pr');
      await chooseWork();
      expect(document.body.textContent).toContain('Could not save the selected account.');
      expect(button('Create PR').disabled).toBe(true);
      expect(button('Change').disabled).toBe(false);
      await act(async () => button('Create PR').click());
      expect(mocks.createPullRequest).not.toHaveBeenCalled();

      mocks.settingsAvailable = true;
      await chooseWork();
      expect(button('Create PR').disabled).toBe(false);
      await act(async () => button('Create PR').click());
      expect(mocks.createPullRequest).toHaveBeenCalledOnce();
    }
  );

  it('keeps Add Remote selection local unless remembering was requested', async () => {
    mocks.createRepository.mockResolvedValueOnce({
      success: true,
      repoUrl: 'https://github.com/acme/repo.git',
    });
    await render('remote');
    await chooseWork();
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => button('Create & Publish').click());
    expect(mocks.createRepository).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'work', initializeWithReadme: false })
    );
    expect(repository.fetchRemote).toHaveBeenCalledWith({
      providerId: 'github',
      accountId: 'work',
    });
    expect(checkout.publishCurrentBranch).toHaveBeenCalledWith({
      providerId: 'github',
      accountId: 'work',
    });
  });

  it('creates a GitLab remote with the selected account and nested group', async () => {
    mocks.createGitlabRepository.mockResolvedValueOnce({
      success: true,
      cloneUrl: 'https://gitlab.com/parent/nested/repo.git',
      nameWithOwner: 'parent/nested/repo',
    });
    await render('remote');
    const providerTrigger = document.querySelector<HTMLElement>(
      '[aria-label="Repository provider"]'
    );
    expect(providerTrigger).not.toBeNull();
    await act(async () => providerTrigger!.click());
    await act(async () => page.getByRole('option', { name: 'GitLab' }).click());
    await act(async () => button('Create & Publish').click());
    expect(mocks.createGitlabRepository).toHaveBeenCalledWith({
      name: 'repo',
      owner: 'parent/nested',
      isPrivate: true,
      accountId: 'gitlab-work',
      initializeWithReadme: false,
    });
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(repository.addRemote).toHaveBeenCalledWith(
      'origin',
      'https://gitlab.com/parent/nested/repo.git'
    );
    expect(repository.fetchRemote).toHaveBeenCalledWith({
      providerId: 'gitlab',
      accountId: 'gitlab-work',
    });
    expect(checkout.publishCurrentBranch).toHaveBeenCalledWith({
      providerId: 'gitlab',
      accountId: 'gitlab-work',
    });
  });

  it('retains Add Remote action credentials when remembering the account fails', async () => {
    const gate = deferred<void>();
    mocks.save.mockImplementation(async () => {
      await gate.promise;
      throw new Error('Wire disconnected');
    });
    await render('remote');
    await chooseWork(true);
    expect(button('Create & Publish').disabled).toBe(true);
    expect(button('Change').disabled).toBe(true);
    await act(async () => gate.resolve());
    expect(document.body.textContent).toContain('It is still selected for this action.');
    expect(button('Create & Publish').disabled).toBe(false);
    await act(async () => button('Create & Publish').click());
    expect(mocks.createRepository).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'work' })
    );
  });
});

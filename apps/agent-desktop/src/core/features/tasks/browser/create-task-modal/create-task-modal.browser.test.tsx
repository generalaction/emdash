import '@agent/ui/style.css';
import { Dialog } from '@agent/ui/react/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { CreateTaskModal } from './create-task-modal';

const mocks = vi.hoisted(() => ({
  provider: 'gitlab',
  supported: true,
  account: vi.fn(),
  accounts: vi.fn(),
  select: vi.fn(),
  list: vi.fn(),
}));
const repositoryUrl = 'https://gitlab.com/group/nested/repo';
const mr = {
  provider: 'gitlab',
  url: `${repositoryUrl}/-/merge_requests/42`,
  repositoryUrl,
  identifier: '!42',
  title: 'Review the MR',
  headRefName: 'feature/review',
  status: 'open',
  isDraft: false,
  author: null,
};
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectStore: () => ({}),
  projectData: () => ({ path: '/repo' }),
  getProjectViewStore: () => ({}),
  firstAvailableProjectId: () => 'project-1',
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => ({
    pullRequestRepositoryUrl: repositoryUrl,
    canonicalRepositoryUrl: repositoryUrl,
    providerRepository: {
      provider: mocks.provider,
      capabilities: { pullRequests: mocks.supported },
    },
  }),
}));
vi.mock('@core/features/tasks/api/browser/create-task-modal/use-project-git-context', () => ({
  useProjectGitContext: () => ({ hasRepository: true, isUnborn: false }),
}));
vi.mock('@core/features/integrations/api/browser/use-connected-issue-providers', () => ({
  useConnectedIssueProviders: () => ({ connectedProviders: [], hasAnyIssueIntegration: false }),
}));
vi.mock('@core/features/tasks/api/browser/hooks/useTaskSettings', () => ({
  useTaskSettings: () => ({}),
}));
vi.mock('./use-create-task-state', async () => {
  const { useState } = await import('react');
  return {
    useCreateTaskState: () => {
      const [linkedType, setLinkedType] = useState<string | null>(null);
      const [linkedPR, setLinkedPR] = useState(null);
      return {
        linkedType,
        setLinkedType,
        linkedPR,
        setLinkedPR: (value: null) => {
          mocks.select(value);
          setLinkedPR(value);
        },
      };
    },
  };
});
vi.mock('./use-create-task-callback', () => ({
  useCreateTaskCallback: () => ({ canCreate: false }),
}));
vi.mock('./task-name-field', () => ({ TaskNameField: () => null }));
vi.mock('./issue-combobox-field', () => ({ IssueComboboxField: () => null }));
vi.mock(
  '@core/features/tasks/contributions/browser/task-config/initial-conversation-section',
  () => ({ useInitialConversationState: () => ({}) })
);
vi.mock('@core/features/tasks/contributions/browser/task-config/task-state-context', () => ({
  TaskStateProvider: () => null,
}));
vi.mock('@core/features/tasks/contributions/browser/task-config/task-config-panel', () => ({
  TaskConfigPanel: () => null,
}));
vi.mock('@core/features/tasks/contributions/browser/task-config/conversation-field', () => ({
  ConversationField: () => null,
}));
vi.mock(
  '@core/features/tasks/contributions/browser/task-config/workspace-settings-section',
  () => ({ WorkspaceSettingsSection: () => null })
);
vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  taskHostActionAvailability: () => ({ kind: 'enabled' }),
}));
vi.mock('@core/manifests/browser/modal-api', () => ({
  useModalController: () => ({}),
  useOpenModal: () => vi.fn(),
}));
vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({}),
}));
vi.mock('@core/primitives/navigation/browser/navigation-selectors', () => ({
  getNavigation: () => ({}),
}));
vi.mock('@core/primitives/keybindings/browser/confirm-button', async () => ({
  ConfirmButton: (await import('@agent/ui/react/primitives')).Button,
}));
vi.mock('@core/features/integrations/api/browser/use-project-account', () => ({
  useProjectAccount: (...args: unknown[]) => {
    mocks.account(...args);
    return { value: {}, provenance: { kind: 'set' } };
  },
}));
vi.mock('@core/features/integrations/api/browser/use-provider-accounts', () => ({
  useAccounts: (...args: unknown[]) => {
    mocks.accounts(...args);
    return { data: [{}] };
  },
}));
vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: () => ({
    integrationById: { gitlab: { name: 'GitLab' }, github: { name: 'GitHub' } },
  }),
}));
vi.mock('@core/primitives/wire/browser/use-remote-model-state', () => ({
  useRemoteModelState: () => ({ value: { revision: 1, phase: 'idle' }, isLoading: false }),
}));
vi.mock('@core/services/pull-requests/api/client', () => ({
  getPullRequestsRuntimeClient: async () => ({ listPullRequests: mocks.list }),
}));

vi.mock('@core/manifests/browser/project-availability-ui', () => ({ projectAvailabilityUi: {} }));
vi.mock('@core/features/integrations/contributions/browser/account-state', () => ({
  ProviderAccountStateEmpty: () => null,
}));
vi.mock('@core/features/integrations/contributions/browser/integration-icon', () => ({
  IntegrationIcon: () => null,
}));

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.provider = 'gitlab';
  mocks.supported = true;
  mocks.list.mockResolvedValue({ success: true, data: { prs: [mr] } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Dialog.Root open>
          <Dialog.Content>
            <CreateTaskModal projectId="project-1" />
          </Dialog.Content>
        </Dialog.Root>
      </QueryClientProvider>
    )
  );
}
it('enables GitLab MR selection and routes account and inventory reads to GitLab', async () => {
  await render();
  const toggle = page.getByRole('button', { name: 'Merge Request', exact: true });
  await expect.element(toggle).toBeEnabled();
  await toggle.click();
  await page.getByText(/Select an MR from/).click();
  await expect.element(page.getByPlaceholder('Search merge requests…')).toBeVisible();
  await page.getByRole('option', { name: /Review the MR/ }).click();
  expect(mocks.select).toHaveBeenCalledWith(mr);
  expect(mocks.account).toHaveBeenCalledWith('project-1', 'gitlab', {
    repository: { kind: 'project' },
  });
  expect(mocks.accounts).toHaveBeenCalledWith('gitlab');
  expect(mocks.list).toHaveBeenCalledWith(
    expect.objectContaining({ repositoryUrls: [repositoryUrl] })
  );
  expect(host.textContent).not.toContain('Pull Request');
});
it('disables request selection when the repository lacks the capability', async () => {
  mocks.supported = false;
  await render();
  await expect
    .element(page.getByRole('button', { name: 'Merge Request', exact: true }))
    .toBeDisabled();
  expect(mocks.list).not.toHaveBeenCalled();
});
it('retains Pull Request terminology for GitHub', async () => {
  mocks.provider = 'github';
  await render();
  await expect
    .element(page.getByRole('button', { name: 'Pull Request', exact: true }))
    .toBeEnabled();
});

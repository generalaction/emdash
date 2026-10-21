import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskListEmptyState } from '@core/features/projects/browser/components/task-view/task-list-empty-state';

const mocks = vi.hoisted(() => ({
  hasAnyIssueIntegration: false,
  connectedProviders: [] as string[],
  selectedProvider: null as string | null,
  repository: null as null | {
    canonicalRepositoryUrl: string | null;
    issueRepositoryUrl: string | null;
    pullRequestRepositoryUrl: string | null;
    providerRepository: { provider: string; host: string };
  },
  openTaskModal: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@core/features/integrations/api/browser/use-connected-issue-providers', () => ({
  useConnectedIssueProviders: (context: { projectId?: string; repositoryUrl?: string }) => ({
    connectedProviders: mocks.connectedProviders,
    hasAnyIssueIntegration:
      mocks.hasAnyIssueIntegration && context.projectId === 'p' && !!context.repositoryUrl,
  }),
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectViewStore: () => ({ selectedIssueProvider: mocks.selectedProvider }),
}));
vi.mock('@core/features/projects/contributions/browser/project-availability-ui', () => ({
  projectAvailabilityUiContribution: {},
}));
vi.mock('@core/features/settings/contributions/views', () => ({
  settingsViewDef: () => ({ view: 'settings', tab: 'integrations' }),
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => mocks.repository,
}));
vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  taskHostActionAvailability: () => ({ kind: 'enabled' }),
}));
vi.mock('@core/manifests/browser/modal-api', () => ({
  useOpenModal: () => mocks.openTaskModal,
}));
vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));
vi.mock('@core/primitives/react-hooks/browser/use-arrow-key-navigation', () => ({
  useArrowKeyNavigation: () => ({ selectedIndex: -1, setSelectedIndex: vi.fn() }),
}));

describe('TaskListEmptyState issue action', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.hasAnyIssueIntegration = false;
    mocks.connectedProviders = [];
    mocks.selectedProvider = null;
    mocks.repository = null;
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost',
    });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('Event', dom.window.Event);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  async function renderIssueAction() {
    await act(async () => root.render(React.createElement(TaskListEmptyState, { projectId: 'p' })));
    const button = [...container.querySelectorAll('button')].find((element) =>
      element.textContent?.startsWith('Create from ')
    );
    if (!button) throw new Error('Issue action was not rendered.');
    return button;
  }

  it('sends GitLab projects to integration setup when no issue account is connected', async () => {
    mocks.repository = {
      canonicalRepositoryUrl: 'https://gitlab.example.com/group/repo',
      issueRepositoryUrl: 'https://gitlab.example.com/group/repo',
      pullRequestRepositoryUrl: null,
      providerRepository: { provider: 'gitlab', host: 'gitlab.example.com' },
    };
    const button = await renderIssueAction();
    expect(button.textContent).toContain('Create from Work Item');
    expect(button.textContent).toContain('Configure integrations');
    await act(async () => button.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ view: 'settings', tab: 'integrations' });
    expect(mocks.openTaskModal).not.toHaveBeenCalled();
  });

  it('keeps GitHub Enterprise issue task creation available', async () => {
    mocks.repository = {
      canonicalRepositoryUrl: 'https://ghe.example.com/group/repo',
      issueRepositoryUrl: 'https://ghe.example.com/group/repo',
      pullRequestRepositoryUrl: 'https://ghe.example.com/group/repo',
      providerRepository: { provider: 'github', host: 'ghe.example.com' },
    };
    const button = await renderIssueAction();
    expect(button.textContent).toContain('Create from Issue');
    expect(button.textContent).toContain('Link and create a task from an issue');
    await act(async () => button.click());
    expect(mocks.openTaskModal).toHaveBeenCalledWith({ projectId: 'p', strategy: 'from-issue' });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('allows GitLab issue tasks when an issue integration is connected', async () => {
    mocks.hasAnyIssueIntegration = true;
    mocks.connectedProviders = ['gitlab'];
    mocks.repository = {
      canonicalRepositoryUrl: 'https://gitlab.com/group/repo',
      issueRepositoryUrl: 'https://gitlab.com/group/repo',
      pullRequestRepositoryUrl: null,
      providerRepository: { provider: 'gitlab', host: 'gitlab.com' },
    };
    const button = await renderIssueAction();
    expect(button.textContent).toContain('Create from Work Item');
    expect(button.textContent).toContain('Link and create a task from a work item');
    await act(async () => button.click());
    expect(mocks.openTaskModal).toHaveBeenCalledWith({ projectId: 'p', strategy: 'from-issue' });
  });

  it('labels a GitLab project for the selected non-GitLab issue provider', async () => {
    mocks.hasAnyIssueIntegration = true;
    mocks.connectedProviders = ['linear', 'gitlab'];
    mocks.selectedProvider = 'linear';
    mocks.repository = {
      canonicalRepositoryUrl: 'https://gitlab.com/group/repo',
      issueRepositoryUrl: 'https://gitlab.com/group/repo',
      pullRequestRepositoryUrl: null,
      providerRepository: { provider: 'gitlab', host: 'gitlab.com' },
    };
    const button = await renderIssueAction();
    expect(button.textContent).toContain('Create from Issue');
    expect(button.textContent).toContain('Link and create a task from an issue');
  });
});

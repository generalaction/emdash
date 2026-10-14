import '@emdash/ui/style.css';
import { err, ok } from '@emdash/shared';
import { defineContract } from '@emdash/wire/rpc';
import { cell, expose, family } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { runInAction } from 'mobx';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createRegisteredProject } from '@core/features/projects/api/browser/stores/project';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
// oxlint-disable-next-line emdash/core-module-boundaries -- integration seeds the production project context instead of mocking selectors
import { ProjectContext } from '@core/features/projects/browser/stores/project-context';
import { createProjectsAppStoreContributions } from '@core/features/projects/contributions/app-stores';
import { projectScopedStoreContributions } from '@core/features/projects/contributions/project-stores';
import { sourceControlContract } from '@core/features/source-control/api';
import { getTaskPrAssociationStore } from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import { sourceControlProjectStoreContributions } from '@core/features/source-control/contributions/browser/project-stores';
import { createUnprovisionedTask } from '@core/features/tasks/api/browser/stores/task-store';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
// oxlint-disable-next-line emdash/core-module-boundaries -- integration uses the real task manager contribution at the project composition boundary
import { taskProjectScopedStoreContributions } from '@core/features/tasks/browser/contributions/project-stores';
import { TaskViewWrapper } from '@core/features/tasks/contributions/browser/task-view-context';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { lifecycleScriptsWireContract } from '@core/features/workspaces/api/lifecycle-scripts-wire-contract';
import { mementoCatalog } from '@core/manifests/shared/memento-catalog';
import {
  mementoKeyId,
  mementosWireContract,
  type MementoModelKey,
  type MementoRow,
} from '@core/primitives/mementos/api';
import { configureMementos, initMementos } from '@core/primitives/mementos/browser';
import { MementoClientProvider } from '@core/primitives/mementos/react';
import { navigationAppStoreContributions } from '@core/primitives/navigation/browser/app-stores';
import { seedTestNavigationHost } from '@core/primitives/navigation/browser/testing';
import { createAppScope, resetAppScope } from '@core/primitives/scoped-stores/browser';
import type { Task } from '@core/primitives/tasks/api';
import type { PullRequest } from '@core/services/pull-requests/api';
import { PullRequestsSectionBody } from '../../pr-section';

const desktop = vi.hoisted(() => ({ openExternal: vi.fn() }));
let sourceWire: ReturnType<typeof createSourceWire>;
let scriptsWire: ReturnType<typeof createScriptsWire>;

vi.mock('@core/primitives/desktop-host/browser/host-client', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  openExternal: desktop.openExternal,
  copyTextToClipboard: vi.fn(),
}));
vi.mock('@core/features/source-control/api/browser/client', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  getSourceControlClient: async () => sourceWire.client,
}));
vi.mock('@core/features/repository/api/client', () => ({
  getRepositoryClient: async () => ({ resolveProvider: async () => err({ type: 'no_remote' }) }),
}));
vi.mock('@core/features/projects/api/browser/client', () => ({
  getProjectsWireClient: async () => ({
    events: { subscribe: async () => () => {} },
    getProjectSettingsPage: async () => err({ type: 'project-not-found' }),
  }),
}));
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => ({
    getConversationsForTask: async () => [],
    events: { subscribe: async () => () => {} },
  }),
}));
vi.mock('@core/features/terminals/api/browser/client', () => ({
  getTerminalsClient: async () => ({ list: async () => ok([]) }),
}));
vi.mock('@core/features/workspaces/api/browser/client', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  getLifecycleScriptsClient: async () => scriptsWire.client,
}));
vi.mock('@core/features/files/api/browser/file-content', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  watchFileContent: async () => () => {},
}));

function createSourceWire() {
  const contract = defineContract({
    repository: defineContract({
      model: sourceControlContract.repository.model,
      getDefaultBranch: sourceControlContract.repository.getDefaultBranch,
    }),
    checkout: defineContract({
      getChangedFiles: sourceControlContract.checkout.getChangedFiles,
      getLog: sourceControlContract.checkout.getLog,
    }),
  });
  return createTestWire(
    contract,
    {
      repository: {
        model: expose(contract.repository.model, {
          refs: cell({ branches: [], tags: [], remoteHeads: [] }),
          remotes: cell({ remotes: [] }),
        }),
        getDefaultBranch: async () => ok({ branch: null }),
      },
      checkout: {
        getChangedFiles: async () => ok({ files: [] }),
        getLog: async () => ok({ commits: [], totalCount: 0 }),
      },
    },
    { validate: 'full' }
  );
}

function createScriptsWire() {
  const contract = defineContract({ runs: lifecycleScriptsWireContract.runs });
  return createTestWire(
    contract,
    { runs: expose(contract.runs, { current: cell({}) }) },
    { validate: 'full' }
  );
}

function pullRequest(identifier: string, status: PullRequest['status']): PullRequest {
  return {
    url: `https://github.com/generalaction/emdash/pull/${identifier}`,
    provider: 'github',
    repositoryUrl: 'https://github.com/generalaction/emdash',
    baseRefName: 'main',
    baseRefOid: 'base',
    headRepositoryUrl: 'https://github.com/MattJColes/emdash',
    headRefName: 'feature',
    headRefOid: 'head',
    identifier: `#${identifier}`,
    title: `Pull request ${identifier}`,
    description: null,
    status,
    isDraft: false,
    additions: null,
    deletions: null,
    changedFiles: null,
    commitCount: null,
    mergeableStatus: null,
    mergeStateStatus: null,
    reviewDecision: null,
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
  };
}

it('renders every associated PR through the real Changes section and applies current details only to its matching link', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const values = family((_key: MementoModelKey) => cell<MementoRow | null>(null), {
    key: mementoKeyId,
  });
  const mementosWire = createTestWire(
    mementosWireContract,
    {
      memento: expose(
        mementosWireContract.memento,
        { value: (key) => values(key) },
        {
          mutations: {
            save: async (context) => {
              const revision = values(context.key).set(context.input);
              await context.observed('value', revision);
              return ok();
            },
            reset: async (context) => {
              const revision = values(context.key).set(null);
              await context.observed('value', revision);
              return ok();
            },
          },
        }
      ),
      deleteAll: async () => ok({ deleted: 0 }),
      deleteBySubject: async () => ok({ deleted: 0 }),
      deleteOrphans: async () => ok({ deleted: 0 }),
    },
    { validate: 'full' }
  );
  configureMementos({ getWireClient: async () => mementosWire.client, catalog: mementoCatalog });
  const mementos = await initMementos();
  sourceWire = createSourceWire();
  scriptsWire = createScriptsWire();
  const navigation = seedTestNavigationHost();
  createAppScope([...navigationAppStoreContributions, ...createProjectsAppStoreContributions([])]);
  const project = {
    type: 'local' as const,
    id: 'project',
    name: 'Project',
    path: '/repo',
    baseRef: 'main',
    repositoryWorkspaceId: 'workspace',
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
  };
  const contributions = [
    ...projectScopedStoreContributions,
    ...sourceControlProjectStoreContributions,
    ...taskProjectScopedStoreContributions,
  ];
  const hydrated = await ProjectContext.hydrate(project, contributions);
  expect(hydrated.success).toBe(true);
  if (!hydrated.success) throw new Error(hydrated.error.message);
  const context = hydrated.data;
  const registered = createRegisteredProject(project);
  runInAction(() => {
    registered.context = { kind: 'available', context };
    getProjectManagerStore().projects.set(project.id, registered);
  });
  const data: Task = {
    id: 'task',
    projectId: project.id,
    name: 'Task',
    status: 'in_progress',
    isPinned: false,
    type: 'task',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    statusChangedAt: project.createdAt,
    conversations: {},
    prs: [],
    workspaceId: 'workspace',
  };
  const task = createUnprovisionedTask(data, {
    get: (token) => context.get(token),
    has: (token) => contributions.some((contribution) => contribution.token.id === token.id),
  });
  runInAction(() => getTaskManagerStore(project.id)?.tasks.set(data.id, task));
  task.transitionToProvisioned(data, project.path, 'workspace');
  await task.ready();
  await vi.waitFor(() => expect(getTaskComposition(project.id, data.id)?.prStore).toBeTruthy());
  const composition = getTaskComposition(project.id, data.id);
  if (!composition?.prStore || !composition.diffView) throw new Error('Task is not ready');
  const prStore = composition.prStore;
  const association = getTaskPrAssociationStore(task);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MementoClientProvider client={mementos}>
            <TaskViewWrapper projectId={project.id} taskId={data.id}>
              <PullRequestsSectionBody syncError={null} />
            </TaskViewWrapper>
          </MementoClientProvider>
        </QueryClientProvider>
      )
    );
    expect(host.querySelector('[aria-label="Associated pull requests"]')).toBeNull();
    const open = pullRequest('42', 'open');
    const closed = pullRequest('43', 'closed');
    await act(async () => {
      association.setAssociation([open, closed], { kind: 'unknown' });
      composition.diffView?.setPrTab('checks');
    });
    expect(host.querySelectorAll('[aria-label="Associated pull requests"] a')).toHaveLength(2);
    const links = host.querySelectorAll<HTMLAnchorElement>('nav a');
    expect([...links].map((link) => link.href)).toEqual([open.url, closed.url]);
    await act(async () => links[1].click());
    expect(desktop.openExternal).toHaveBeenCalledExactlyOnceWith(closed.url);
    await act(async () =>
      runInAction(() => {
        prStore.details = {
          pr: { ...open, title: 'Refreshed metadata' },
          comments: [],
          commentsFetchedAt: 0,
          refreshing: false,
          stale: false,
          errors: {},
        };
      })
    );
    expect(links[0].textContent).toContain('Refreshed metadata');
    expect(links[1].textContent).toContain(closed.title);
    await act(async () => {
      prStore.details = null;
      association.setAssociation([closed], { kind: 'unknown' });
      composition.diffView?.setPrTab('checks');
    });
    expect(host.querySelectorAll('nav a')).toHaveLength(1);
    expect(host.querySelector('nav a')?.getAttribute('href')).toBe(closed.url);
    await act(async () => association.setAssociation([], { kind: 'unknown' }));
    expect(host.querySelector('nav')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    queryClient.clear();
    resetAppScope();
    navigation.dispose();
    await context.dispose();
    await mementos.dispose();
    await Promise.all([mementosWire.dispose(), sourceWire.dispose(), scriptsWire.dispose()]);
    await values.dispose();
  }
});

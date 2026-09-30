import { decodeResourceUri } from '@emdash/core/primitives/path/api';
import type { FileContentModel } from '@emdash/core/runtimes/files/api';
import type { CheckoutHeadState, CheckoutStatusState } from '@emdash/core/runtimes/git/api';
import { localBranchRefSchema } from '@emdash/core/runtimes/git/api';
import { ok } from '@emdash/shared';
import { createEventStreamHost } from '@emdash/wire/live';
import { createInProcessWire, defineContract } from '@emdash/wire/rpc';
import { cell, expose, snapshot } from '@emdash/wire/state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { openFileStore } from '@core/features/editor/api/browser/open-file-store/open-file-store';
import { installMonacoFacetBinder } from '@core/features/editor/browser/monaco/install-monaco-facet-binder';
import { monacoBootstrap } from '@core/features/editor/browser/monaco/monaco-bootstrap';
import { filesWireContract } from '@core/features/files/api';
import { projectsWireContract } from '@core/features/projects/api/wire-contract';
import { sourceControlContract } from '@core/features/source-control/api';
import { DiffViewStore } from '@core/features/source-control/api/browser/diff-view/stores/diff-view-store';
import { GitRepositoryStore } from '@core/features/source-control/api/browser/stores/git-repository-store';
import { PrStore } from '@core/features/source-control/api/browser/stores/pr-store';
import { TaskPrAssociationStore } from '@core/features/source-control/api/browser/stores/task-pr-association-store';
import { ChangesListOrTree } from '@core/features/source-control/browser/diff-view/changes-panel/components/changes-list-or-tree';
import { WorktreePicker } from '@core/features/source-control/browser/diff-view/changes-panel/worktree-picker';
import { DiffView } from '@core/features/source-control/browser/diff-view/main-panel/diff-view';
import { DiffTabResource } from '@core/features/source-control/browser/diff-view/stores/diff-tab-resource';
import {
  diffTabManagerStoreToken,
  sourceControlPersistentTaskStoreContributions,
} from '@core/features/source-control/contributions/browser/task-stores';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import {
  taskDiffPreferencesMemento,
  taskDiffSelectionMemento,
  type TaskDiffPreferencesState,
} from '@core/features/tasks/contributions/mementos';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import { lifecycleScriptsWireContract } from '@core/features/workspaces/api/lifecycle-scripts-wire-contract';
import { projectWorkspacesContract } from '@core/features/workspaces/api/project-contracts';
import { workspaceRegistryWireContract } from '@core/features/workspaces/api/registry-wire-contract';
import { hostFileRefFromNativePath, portablePath } from '@core/primitives/desktop-runtime/api';
import { commitRef } from '@core/primitives/git/api';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import { ScopedStoreHost } from '@core/primitives/scoped-stores/browser';
import { ThemeProvider } from '@core/primitives/theme/browser';
import { resetWireConnection, seedWireConnection } from '@core/primitives/wire/browser/connection';
import type { HostWorkspaceGroupsData, ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import '@emdash/ui/style.css';

function row(id: string, branch: string, parentId: string | null = 'repo'): ProjectWorkspaceRow {
  return {
    kind: id === 'repo' ? 'root' : 'candidate',
    projectId: 'project',
    workspaceId: id,
    parentId,
    path: `/repo/${id}`,
    branch,
    tasks: [],
    usage: null,
    gitStats: null,
    pathState: 'measured',
    observedStatus: 'present',
    pendingRemoval: false,
    canCleanArtifacts: false,
    canDelete: false,
    hasActiveSessions: false,
    errors: [],
  };
}

function memoryHandle<T>(initial: T): MementoHandle<T> {
  const state = observable.box(initial, { deep: false });
  return {
    get value() {
      return state.get();
    },
    update(next) {
      runInAction(() =>
        state.set(typeof next === 'function' ? (next as (value: T) => T)(state.get()) : next)
      );
    },
  } as MementoHandle<T>;
}

function status(): CheckoutStatusState {
  const path = portablePath('shared.py');
  return {
    kind: 'ok',
    entries: { [path]: { path, index: 'unmodified', worktree: 'modified', isConflicted: false } },
    summary: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 },
    operation: 'none',
  };
}

function head(branch: string): CheckoutHeadState {
  return {
    kind: 'branch',
    ref: localBranchRefSchema.parse(`refs/heads/${branch}`),
    oid: '1234567890123456789012345678901234567890',
    upstream: { kind: 'none' },
  };
}

it('selects discovered worktrees, retains tab sources, and handles live discovery and removal', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const rows = [
    row('repo', 'main', null),
    row('task', 'task'),
    row('subagent', 'subagent'),
    row('unrelated', 'other', 'other-repo'),
  ];
  const groups = cell<HostWorkspaceGroupsData>({
    groups: [{ project: { id: 'project', name: 'Project' }, workspaces: rows, warnings: [] }],
  });
  const statuses = new Map(rows.map((entry) => [entry.workspaceId, cell(status())]));
  const heads = new Map(rows.map((entry) => [entry.workspaceId, cell(head(entry.branch!))]));
  const refresh = vi.fn(async () => ok(undefined));
  const contract = defineContract({
    sourceControl: sourceControlContract,
    projectWorkspaces: projectWorkspacesContract,
    workspaceRegistry: workspaceRegistryWireContract,
    projects: defineContract({ events: projectsWireContract.events }),
    files: defineContract({ content: filesWireContract.content }),
    lifecycleScripts: defineContract({ runs: lifecycleScriptsWireContract.runs }),
  });
  const projectEvents = createEventStreamHost(contract.projects.events);
  const wire = createInProcessWire(
    contract,
    {
      sourceControl: {
        repository: {
          model: expose(contract.sourceControl.repository.model, {
            refs: cell({ branches: [], tags: [], remoteHeads: [] }),
            remotes: cell({ remotes: [] }),
          }),
          fetch: { run: vi.fn() },
          fetchPrForReview: { run: vi.fn() },
        },
        checkout: {
          model: expose(contract.sourceControl.checkout.model, {
            status: ({ workspaceId }) => statuses.get(workspaceId)!,
            head: ({ workspaceId }) => heads.get(workspaceId)!,
          }),
          getChangedFiles: async ({
            workspaceId,
            target,
          }: {
            workspaceId: string;
            target: { kind: string };
          }) =>
            ok({
              files:
                target.kind === 'staged-vs-head'
                  ? []
                  : [
                      {
                        path: portablePath('shared.py'),
                        status: 'modified',
                        additions: workspaceId === 'task' ? 1 : 2,
                        deletions: 1,
                      },
                    ],
            }),
          push: { run: vi.fn() },
          publish: { run: vi.fn() },
          pull: { run: vi.fn() },
        },
      },
      projectWorkspaces: {
        workspaceGroups: expose(contract.projectWorkspaces.workspaceGroups, { list: groups }),
      },
      workspaceRegistry: { refresh },
      projects: { events: projectEvents },
      lifecycleScripts: {
        runs: expose(contract.lifecycleScripts.runs, { current: cell({}) }),
      },
      files: {
        content: expose(contract.files.content, {
          content: ({ uri, source }) => {
            const decoded = decodeResourceUri(uri);
            if (!decoded.success || decoded.data.path.segments.at(-1) === '.emdash.json') {
              return cell<FileContentModel>({
                kind: 'unavailable',
                path: portablePath('.emdash.json'),
                code: 'not-found',
              });
            }
            const content = source === 'disk' ? 'answer = 2\nsubagent = True\n' : 'answer = 1\n';
            return cell<FileContentModel>({
              kind: 'text',
              path: portablePath('shared.py'),
              content,
              eol: 'lf',
              etag: content,
              byteSize: content.length,
              readonly: source !== 'disk',
            });
          },
        }),
      },
    } as never,
    { validate: 'full' }
  );
  resetWireConnection();
  seedWireConnection(async () => wire.connection);
  const repository = new GitRepositoryStore(
    'project',
    {} as never,
    {
      state: { kind: 'ready', hostGeneration: 1 },
    } as never
  );
  const workspace = workspaceRegistry.acquire({
    projectId: 'project',
    workspaceId: 'task',
    path: '/repo/task',
    gitRepository: repository,
  });
  workspaceRegistry.activate('task');
  const git = workspace.get(gitCheckoutStoreToken);
  await vi.waitFor(() => expect(git.unstagedFileChanges).toHaveLength(1));
  const pr = new PrStore('project', 'task', repository, git, new TaskPrAssociationStore());
  const selection = memoryHandle(taskDiffSelectionMemento.default);
  const view = new DiffViewStore(
    git,
    pr,
    memoryHandle(taskDiffPreferencesMemento.default),
    selection,
    {
      projectId: 'project',
      taskId: 'task',
      workspace,
      gitRepository: repository,
    }
  );
  const taskStores = new ScopedStoreHost(
    {
      projectId: 'project',
      taskId: 'task',
      task: {} as never,
      projectStores: {} as never,
    },
    sourceControlPersistentTaskStoreContributions
  );
  const manager = taskStores.get(diffTabManagerStoreToken);
  manager.bindSession({ gitCheckout: git, pr, diffView: view });
  const query = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const host = document.createElement('div');
  host.style.cssText =
    'width: 1020px; height: 440px; background: var(--em-surface); color: var(--em-foreground); margin: 20px; border: 1px solid #555';
  document.body.append(host);
  const root = createRoot(host);
  let tab: DiffTabResource | undefined;
  let sibling: DiffTabResource | undefined;
  const otherTaskStores = new ScopedStoreHost(
    {
      projectId: 'project',
      taskId: 'task-b',
      task: {} as never,
      projectStores: {} as never,
    },
    sourceControlPersistentTaskStoreContributions
  );
  const otherManager = otherTaskStores.get(diffTabManagerStoreToken);
  const otherPr = new PrStore('project', 'task', repository, git, new TaskPrAssociationStore());
  const otherView = new DiffViewStore(
    git,
    otherPr,
    memoryHandle<TaskDiffPreferencesState>({
      ...taskDiffPreferencesMemento.default,
      diffStyle: 'split',
    }),
    memoryHandle(taskDiffSelectionMemento.default),
    { projectId: 'project', taskId: 'task-b', workspace, gitRepository: repository }
  );
  let ownerTab: DiffTabResource | undefined;
  const styles = document.createElement('style');
  // Browser slice tests do not mount the renderer's Tailwind pipeline.
  styles.textContent = `
    body { margin: 0; font-family: system-ui; background: #151515; }
    .flex { display: flex; } .flex-col { flex-direction: column; }
    .flex-1 { flex: 1 1 0%; } .shrink-0 { flex-shrink: 0; }
    .min-h-0 { min-height: 0; } .min-w-0 { min-width: 0; }
    .h-full { height: 100%; } .w-full { width: 100%; }
    .invisible { visibility: hidden; }
    .truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .text-xs { font-size: 12px; } .text-sm { font-size: 14px; }
    .text-left { text-align: left; } .justify-start { justify-content: flex-start; }
    .justify-between { justify-content: space-between; } .items-center { align-items: center; }
    .gap-2 { gap: 8px; } .gap-3 { gap: 12px; }
    .p-2 { padding: 8px; } .px-2 { padding-inline: 8px; }
    .mt-1 { margin-top: 4px; } .border-b { border-bottom: 1px solid #444; }
    .border-t { border-top: 1px solid #444; }
    .h-\\[41px\\] { height: 41px; flex-shrink: 0; }
    .text-foreground-muted { color: #aaa; }
    .size-3\\.5 { width: 14px; height: 14px; }
  `;
  document.head.append(styles);
  const Screen = observer(function Screen({ diff }: { diff?: DiffTabResource }) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '270px minmax(0, 1fr)', height: '100%' }}>
        <div style={{ borderRight: '1px solid #444', display: 'flex', flexDirection: 'column' }}>
          <WorktreePicker view={view} />
          <div style={{ padding: 12, fontSize: 12 }}>
            Changed · {view.gitCheckout.unstagedFileChanges.length} file
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChangesListOrTree
              viewMode="flat"
              changes={view.gitCheckout.unstagedFileChanges}
              rootPath={view.workspace.path}
            />
          </div>
        </div>
        {diff ? (
          <DiffView tab={diff} />
        ) : (
          <div style={{ padding: 20 }}>Select a worktree to inspect its changes.</div>
        )}
      </div>
    );
  });
  const render = async () =>
    act(async () =>
      root.render(
        <ThemeProvider theme="emdark" onThemeChange={() => {}}>
          <QueryClientProvider client={query}>
            <Screen diff={tab} />
          </QueryClientProvider>
        </ThemeProvider>
      )
    );

  try {
    await vi.waitFor(() => expect(view.worktrees).toHaveLength(3));
    await vi.waitFor(() => expect(git.unstagedFileChanges).toHaveLength(1));
    await page.viewport(1100, 620);
    await render();
    await act(async () => page.getByRole('button', { name: 'Select worktree: task' }).click());
    await expect
      .element(page.getByRole('menuitem', { name: /task · Task worktree/ }))
      .toHaveAttribute('aria-current', 'true');
    await expect
      .element(page.getByRole('menuitem', { name: /other.*unrelated/ }))
      .not.toBeInTheDocument();
    await act(async () => page.getByRole('menuitem', { name: /subagent/ }).click());
    await vi.waitFor(() => expect(view.gitCheckout.unstagedFileChanges[0]?.additions).toBe(2));
    expect(view.workspace.path).toBe('/repo/subagent');
    expect(selection.value.selectedWorkspaceId).toBe('subagent');
    await expect.element(page.getByText('Read-only inspection')).toBeVisible();
    tab = new DiffTabResource(
      'diff-subagent',
      {
        workspaceId: 'subagent',
        path: portablePath('shared.py'),
        diffGroup: 'disk',
        originalRef: commitRef('HEAD'),
      },
      manager
    );
    await monacoBootstrap.init();
    installMonacoFacetBinder();
    await render();
    await vi.waitFor(
      () =>
        expect(
          openFileStore
            .peek(hostFileRefFromNativePath('/repo/subagent/shared.py'))
            ?.handleFor({ kind: 'buffer' })
            ?.getText()
        ).toContain('subagent = True'),
      { timeout: 10_000 }
    );
    await vi.waitFor(
      () =>
        expect(
          monacoBootstrap.getMonaco()?.editor.getDiffEditors()[0]?.getLineChanges()?.length
        ).toBeGreaterThan(0),
      { timeout: 10_000 }
    );
    if (import.meta.env.VITE_EMDASH_CAPTURE_WORKTREE_SCREENS === '1') {
      await page.screenshot({ path: '/tmp/emdash-worktree-diff.png', element: host });
    }
    view.selectWorkspace('task');
    expect(tab.workspace?.path).toBe('/repo/subagent');
    sibling = new DiffTabResource(
      'diff-subagent-sibling',
      {
        workspaceId: 'subagent',
        path: portablePath('shared.py'),
        diffGroup: 'disk',
        originalRef: commitRef('HEAD'),
      },
      manager
    );
    sibling.dispose();
    sibling.dispose();
    expect(tab.workspace?.path).toBe('/repo/subagent');
    ownerTab = new DiffTabResource(
      'owner-a',
      {
        workspaceId: 'task',
        path: portablePath('shared.py'),
        diffGroup: 'disk',
        originalRef: commitRef('HEAD'),
      },
      manager
    );
    otherManager.bindSession({ gitCheckout: git, pr: otherPr, diffView: otherView });
    expect(otherManager).not.toBe(manager);
    expect(ownerTab.readOnly).toBe(false);
    expect(ownerTab.diffView?.taskId).toBe('task');
    expect(ownerTab.diffView?.diffStyle).toBe('unified');
    expect(otherManager.currentDiffView()?.taskId).toBe('task-b');
    expect(otherManager.currentDiffView()?.diffStyle).toBe('split');
    tab.onActivate();
    expect(view.selectedWorkspaceId).toBe('subagent');

    const discovered = row('new-worktree', 'new-branch');
    statuses.set(discovered.workspaceId, cell(status()));
    heads.set(discovered.workspaceId, cell(head('new-branch')));
    groups.set({
      groups: [
        {
          project: { id: 'project', name: 'Project' },
          workspaces: [...rows, discovered],
          warnings: [],
        },
      ],
    });
    await vi.waitFor(() => expect(view.worktrees).toHaveLength(4));
    await act(async () => page.getByRole('button', { name: 'Select worktree: subagent' }).click());
    await expect.element(page.getByRole('menuitem', { name: /new-branch/ })).toBeVisible();
    if (import.meta.env.VITE_EMDASH_CAPTURE_WORKTREE_SCREENS === '1') {
      const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
      if (!menu) throw new Error('Worktree picker did not open');
      await Promise.all(menu.getAnimations().map((animation) => animation.finished));
      await page.screenshot({ path: '/tmp/emdash-worktree-picker.png', element: host });
    }
    await act(async () => page.getByRole('menuitem', { name: /new-branch/ }).click());
    await vi.waitFor(() => expect(view.gitCheckout.branchName).toBe('new-branch'));
    expect(view.workspace.path).toBe('/repo/new-worktree');
    groups.set({
      groups: [
        {
          project: { id: 'project', name: 'Project' },
          workspaces: rows.filter((entry) => entry.workspaceId !== 'subagent'),
          warnings: [],
        },
      ],
    });
    await vi.waitFor(() => expect(view.selectedWorkspaceId).toBe('task'));
    expect(tab.unavailable).toBe(true);
    expect(tab.workspace).toBeUndefined();
    expect(snapshot(groups).value?.groups[0]?.workspaces).toHaveLength(3);
    await expect
      .element(page.getByText('The inspected worktree is no longer available.'))
      .toBeVisible();
    expect(refresh).toHaveBeenCalled();
    if (import.meta.env.VITE_EMDASH_CAPTURE_WORKTREE_SCREENS === '1') {
      await page.screenshot({ path: '/tmp/emdash-worktree-unavailable.png', element: host });
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    styles.remove();
    tab?.dispose();
    sibling?.dispose();
    ownerTab?.dispose();
    manager.unbindSession();
    otherManager.unbindSession();
    otherView.dispose();
    otherPr.dispose();
    taskStores.dispose();
    otherTaskStores.dispose();
    view.dispose();
    pr.dispose();
    repository.dispose();
    workspaceRegistry.release('task', workspace);
    query.clear();
    resetWireConnection();
    await openFileStore.dispose();
    projectEvents.dispose();
    await wire.dispose();
  }
}, 30_000);

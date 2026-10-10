import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfigState } from '@core/features/tasks/api/browser/create-task-modal/use-workspace-config';
import type { PullRequest } from '@core/services/pull-requests/api';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: { pushOnCreate: true } }),
}));

// The hook reads the resolved base and push remotes from the repository store;
// individual tests null them out to exercise the honest no-remote degrade.
const repositoryStoreMock = vi.hoisted(() => ({
  current: {
    baseRemote: { name: 'origin', url: 'https://github.com/acme/repo.git' },
    pushRemote: { name: 'fork', url: 'https://github.com/me/repo.git' },
  } as {
    baseRemote: { name: string; url: string } | null;
    pushRemote: { name: string; url: string } | null;
  } | null,
}));

vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => repositoryStoreMock.current,
}));
// The real module transitively imports monaco, which cannot load in the node project.
// Mirror the registry-backed resolved file-handling domain consumed by the preview.
const projectConfigMock = vi.hoisted(() => ({
  preservePatterns: ['.env'] as string[],
  fetchLatestBase: false,
  loaded: true,
  error: undefined as string | undefined,
  loading: false,
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: () => ({
    pageData: { error: projectConfigMock.error, loading: projectConfigMock.loading },
    durableDomains: projectConfigMock.loaded
      ? { gitIdentity: { stored: { fetchLatestBase: projectConfigMock.fetchLatestBase } } }
      : null,
    domains: {
      fileHandling: {
        resolved: {
          preservePatterns: { value: projectConfigMock.preservePatterns, from: 'personal' },
        },
      },
    },
  }),
}));

const workspaceOptionsMock = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
vi.mock('@core/features/tasks/api/browser/create-task-modal/use-project-workspace-options', () => ({
  useProjectWorkspaceOptions: () => ({ data: workspaceOptionsMock.current, isLoading: false }),
}));

const branchNameMock = vi.hoisted(() => ({ current: 'generated-task-branch' }));

vi.mock('./use-branch-name', () => ({
  useBranchName: () => ({
    branchName: branchNameMock.current,
    setBranchName: vi.fn(),
    branchAlreadyExists: false,
  }),
}));

const { useWorkspaceConfig } =
  await import('../../api/browser/create-task-modal/use-workspace-config');

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    url: 'https://github.com/acme/repo/pull/7',
    provider: 'github',
    repositoryUrl: 'https://github.com/acme/repo',
    baseRefName: 'main',
    baseRefOid: 'base-oid',
    headRepositoryUrl: 'https://github.com/contributor/repo',
    headRefName: 'fix/thing',
    headRefOid: 'head-oid',
    identifier: '#7',
    title: 'Fork PR',
    description: null,
    status: 'open',
    isDraft: false,
    additions: null,
    deletions: null,
    changedFiles: null,
    commitCount: null,
    mergeableStatus: null,
    mergeStateStatus: null,
    reviewDecision: null,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
    ...overrides,
  };
}

let latestState: WorkspaceConfigState | undefined;

function Probe({
  initial,
  isUnborn = false,
  hasRepository = true,
  pr = null,
  projectId = 'project-1',
}: {
  initial: Parameters<typeof useWorkspaceConfig>[0]['initial'];
  isUnborn?: boolean;
  hasRepository?: boolean;
  pr?: Parameters<typeof useWorkspaceConfig>[0]['pr'];
  projectId?: string;
}) {
  latestState = useWorkspaceConfig({
    projectId,
    defaultBranch: { type: 'local', branch: 'main' },
    isUnborn,
    hasRepository,
    currentBranch: 'current-branch',
    repositoryWorkspaceId: 'repo-workspace-1',
    pr,
    taskName: 'Generated task branch',
    linkedIssue: null,
    createBranchAndWorktreeDefault: true,
    resetKey: projectId,
    initial,
  });
  return null;
}

describe('useWorkspaceConfig branch selection', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    latestState = undefined;
    branchNameMock.current = 'generated-task-branch';
    workspaceOptionsMock.current = [];
    projectConfigMock.preservePatterns = ['.env'];
    projectConfigMock.fetchLatestBase = false;
    projectConfigMock.loaded = true;
    projectConfigMock.error = undefined;
    projectConfigMock.loading = false;
    repositoryStoreMock.current = {
      baseRemote: { name: 'origin', url: 'https://github.com/acme/repo.git' },
      pushRemote: { name: 'fork', url: 'https://github.com/me/repo.git' },
    };
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  async function renderProbe(
    initial: Parameters<typeof useWorkspaceConfig>[0]['initial'],
    options: {
      isUnborn?: boolean;
      hasRepository?: boolean;
      pr?: Parameters<typeof useWorkspaceConfig>[0]['pr'];
      projectId?: string;
    } = {}
  ) {
    await act(async () => {
      root.render(React.createElement(Probe, { initial, ...options }));
    });
  }

  it('uses the current branch when checkout mode is selected without an explicit branch', async () => {
    await renderProbe(undefined);

    act(() => {
      latestState?.branchSelection.setCreateBranchAndWorktree(false);
    });

    expect(latestState?.branchSelection.createBranchAndWorktree).toBe(false);
    expect(latestState?.branchSelection.selectedBranch).toEqual({
      type: 'local',
      branch: 'current-branch',
    });
    expect(latestState?.resolvedConfig.git).toEqual({
      kind: 'use-branch',
      branchName: 'current-branch',
    });
  });

  it('uses the configured default branch when initial checkout mode has no explicit selection', async () => {
    await renderProbe({
      mode: 'new-worktree',
      presetId: 'new-worktree',
      branchSelection: {
        createBranchAndWorktree: false,
      },
    });

    expect(latestState?.branchSelection.createBranchAndWorktree).toBe(false);
    expect(latestState?.branchSelection.selectedBranch).toEqual({
      type: 'local',
      branch: 'main',
    });
    expect(latestState?.resolvedConfig.git).toEqual({
      kind: 'use-branch',
      branchName: 'main',
    });
  });

  it('restores checkout-branch automations as use-branch configs', async () => {
    await renderProbe({
      mode: 'new-worktree',
      presetId: 'new-worktree',
      branchSelection: {
        createBranchAndWorktree: false,
        branchOverride: { type: 'local', branch: 'release/v2' },
      },
    });

    expect(latestState?.branchSelection.createBranchAndWorktree).toBe(false);
    expect(latestState?.resolvedConfig.git).toEqual({
      kind: 'use-branch',
      branchName: 'release/v2',
    });
  });

  it('restores create-branch automations with the stored fromBranch', async () => {
    await renderProbe({
      mode: 'new-worktree',
      presetId: 'new-worktree',
      branchSelection: {
        createBranchAndWorktree: true,
        branchOverride: { type: 'local', branch: 'release/v2' },
        pushBranch: false,
      },
    });

    expect(latestState?.branchSelection.selectedBranch).toEqual({
      type: 'local',
      branch: 'release/v2',
    });
    expect(latestState?.resolvedConfig.git).toEqual({
      kind: 'create-branch',
      branchName: 'generated-task-branch',
      fromBranch: { type: 'local', branch: 'release/v2' },
      fetchLatestBase: false,
      pushBranch: false,
    });
  });

  const remoteBase = {
    type: 'remote' as const,
    branch: 'main',
    remote: { name: 'origin', url: 'https://github.com/acme/repo.git' },
  };

  it('inherits the project preference and previews the blocking fetch', async () => {
    projectConfigMock.fetchLatestBase = true;
    await renderProbe({ branchSelection: { branchOverride: remoteBase } });
    expect(latestState?.fetchLatestBase).toBe(true);
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: true });
    expect(latestState?.setupSteps[0]?.id).toBe('fetch-remote-base');
    act(() => latestState?.setFetchLatestBase(false));
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: false });
    expect(latestState?.setupSteps.some((step) => step.id === 'fetch-remote-base')).toBe(false);
  });

  it('restores an explicit false choice even when the project preference is enabled', async () => {
    projectConfigMock.fetchLatestBase = true;
    await renderProbe({
      fetchLatestBase: false,
      branchSelection: { branchOverride: remoteBase },
    });
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: false });
  });

  it('disables fetching for local bases and restores the choice for remote bases', async () => {
    projectConfigMock.fetchLatestBase = true;
    await renderProbe({ branchSelection: { branchOverride: remoteBase } });
    act(() => latestState?.branchSelection.setSelectedBranch({ type: 'local', branch: 'main' }));
    expect(latestState?.canFetchLatestBase).toBe(false);
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: false });
    act(() => latestState?.branchSelection.setSelectedBranch(remoteBase));
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: true });
  });

  it('clears a creation override when changing projects', async () => {
    await renderProbe({ branchSelection: { branchOverride: remoteBase } });
    act(() => latestState?.setFetchLatestBase(true));
    await renderProbe(undefined, { projectId: 'project-2' });
    act(() => latestState?.branchSelection.setSelectedBranch(remoteBase));
    expect(latestState?.fetchLatestBase).toBe(false);
  });

  it('uses the new project preference after changing a saved configuration’s project', async () => {
    projectConfigMock.fetchLatestBase = true;
    const initial = { fetchLatestBase: false, branchSelection: { branchOverride: remoteBase } };
    await renderProbe(initial);
    expect(latestState?.fetchLatestBase).toBe(false);
    await renderProbe(initial, { projectId: 'project-2' });
    act(() => latestState?.branchSelection.setSelectedBranch(remoteBase));
    expect(latestState?.fetchLatestBase).toBe(true);
  });

  it('waits for the project preference before allowing a new branch creation', async () => {
    projectConfigMock.loaded = false;
    await renderProbe({ branchSelection: { branchOverride: remoteBase } });
    expect(latestState?.isValid).toBe(false);
    projectConfigMock.loaded = true;
    projectConfigMock.fetchLatestBase = true;
    await renderProbe({ branchSelection: { branchOverride: remoteBase } });
    expect(latestState?.isValid).toBe(true);
    expect(latestState?.fetchLatestBase).toBe(true);
  });

  it('allows local-base creation even when project defaults cannot load', async () => {
    projectConfigMock.loaded = false;
    projectConfigMock.error = 'Failed to load project settings';
    await renderProbe(undefined);
    expect(latestState?.isValid).toBe(true);
    expect(latestState?.canFetchLatestBase).toBe(false);
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: false });
  });

  it('allows cached remote-base creation after a defaults-load failure and exposes the fallback', async () => {
    projectConfigMock.loaded = false;
    await renderProbe({ branchSelection: { branchOverride: remoteBase } });
    expect(latestState?.isValid).toBe(false);
    projectConfigMock.error = 'Failed to load project settings';
    await renderProbe({ branchSelection: { branchOverride: remoteBase } });
    expect(latestState?.isValid).toBe(true);
    expect(latestState?.fetchLatestBaseSettingsUnavailable).toBe(true);
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: false });
    act(() => latestState?.setFetchLatestBase(true));
    expect(latestState?.isValid).toBe(true);
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: true });
  });

  it('waits for a settings retry despite the retained error, unless the user chooses an override', async () => {
    projectConfigMock.loaded = false;
    projectConfigMock.error = 'Failed to load project settings';
    projectConfigMock.loading = true;
    await renderProbe({ branchSelection: { branchOverride: remoteBase } });
    expect(latestState?.fetchLatestBaseSettingsUnavailable).toBe(false);
    expect(latestState?.isValid).toBe(false);
    act(() => latestState?.setFetchLatestBase(false));
    expect(latestState?.isValid).toBe(true);
    expect(latestState?.resolvedConfig.git).toMatchObject({ fetchLatestBase: false });
  });

  it('defaults unborn repositories to the repository root workspace', async () => {
    await renderProbe(undefined, { isUnborn: true });

    expect(latestState?.mode).toBe('existing');
    expect(latestState?.presetId).toBe('repo-root');
    expect(latestState?.isValid).toBe(true);
    expect(latestState?.resolvedConfig).toEqual({
      version: '2',
      git: { kind: 'none' },
      workspace: { kind: 'repository-instance', workspaceId: 'repo-workspace-1' },
    });
    expect(latestState?.setupSteps).toEqual([]);
  });

  it('starts in use-existing mode with a preselected workspace', async () => {
    workspaceOptionsMock.current = [
      {
        key: 'project-1\0workspace-existing-1',
        workspaceId: 'workspace-existing-1',
        kind: 'worktree',
        path: '/repo/workspace-existing-1',
        branchName: 'existing-branch',
        linesAdded: null,
        linesDeleted: null,
        taskName: null,
        isLive: false,
        linkedTaskCount: 0,
      },
    ];
    await renderProbe({
      mode: 'existing',
      presetId: 'use-existing',
      selectedWorkspaceId: 'workspace-existing-1',
    });

    expect(latestState?.mode).toBe('existing');
    expect(latestState?.presetId).toBe('use-existing');
    expect(latestState?.selectedWorkspaceId).toBe('workspace-existing-1');
    expect(latestState?.isValid).toBe(true);
    expect(latestState?.resolvedConfig).toEqual({
      version: '2',
      git: { kind: 'none' },
      workspace: { kind: 'repository-instance', workspaceId: 'workspace-existing-1' },
    });
  });

  it('previews the compiled plan for a new pushed branch', async () => {
    await renderProbe({ mode: 'new-worktree', presetId: 'new-worktree' });

    expect(latestState?.setupSteps.map((step) => step.id)).toEqual([
      'create-worktree',
      'copy-artifacts',
      'push-branch',
    ]);
    expect(latestState?.setupSteps[0]?.description).toBe(
      'Create a worktree on new branch generated-task-branch based on main'
    );
  });

  it('omits copy-artifacts when resolved preservePatterns are empty', async () => {
    projectConfigMock.preservePatterns = [];
    await renderProbe({ mode: 'new-worktree', presetId: 'new-worktree' });

    expect(latestState?.setupSteps.map((step) => step.id)).toEqual([
      'create-worktree',
      'push-branch',
    ]);
  });

  it('previews the fork PR checkout with the namespaced branch and PR-ref fetch', async () => {
    await renderProbe({ mode: 'new-worktree', presetId: 'checkout-pr' }, { pr: makePr() });

    expect(latestState?.setupSteps.map((step) => step.id)).toEqual([
      'fetch-branch',
      'create-worktree',
      'configure-branch',
      'copy-artifacts',
    ]);
    expect(latestState?.setupSteps[0]?.description).toBe(
      'Fetch refs/pull/7/head from origin into pr/7/fix/thing'
    );
  });

  it('renders an empty preview for a PR checkout when the repository has no remotes', async () => {
    repositoryStoreMock.current = { baseRemote: null, pushRemote: null };
    await renderProbe({ mode: 'new-worktree', presetId: 'checkout-pr' }, { pr: makePr() });

    // PR-sourced plans need a base remote to fetch PR heads from; node-side
    // createTask refuses in the same case, so the preview promises nothing.
    expect(latestState?.setupSteps).toEqual([]);
  });

  it('renders an empty preview when the PR preset has no PR selected yet', async () => {
    await renderProbe({ mode: 'new-worktree', presetId: 'checkout-pr' });

    expect(latestState?.resolvedConfig.git).toEqual({ kind: 'none' });
    expect(latestState?.setupSteps).toEqual([]);
    expect(latestState?.isValid).toBe(false);
  });

  it('renders an empty preview while the branch name is still empty', async () => {
    branchNameMock.current = '';
    await renderProbe({ mode: 'new-worktree', presetId: 'new-worktree' });

    expect(latestState?.setupSteps).toEqual([]);
    expect(latestState?.isValid).toBe(false);
  });

  it('defaults non-git projects to the repository root workspace', async () => {
    await renderProbe(
      {
        mode: 'new-worktree',
        presetId: 'new-worktree',
      },
      { hasRepository: false }
    );

    expect(latestState?.mode).toBe('existing');
    expect(latestState?.presetId).toBe('repo-root');
    expect(latestState?.isValid).toBe(true);
    expect(latestState?.resolvedConfig.git).toEqual({ kind: 'none' });
  });
});

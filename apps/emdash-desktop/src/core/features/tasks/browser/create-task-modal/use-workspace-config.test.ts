import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfigState } from '@core/features/tasks/api/browser/create-task-modal/use-workspace-config';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: { pushOnCreate: true } }),
}));

vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => undefined,
}));

vi.mock('@core/features/tasks/browser/task-config/existing-workspace-picker', () => ({
  useProjectWorkspaces: () => ({ data: [] }),
}));

vi.mock('./use-branch-name', () => ({
  useBranchName: () => ({
    branchName: 'generated-task-branch',
    setBranchName: vi.fn(),
    branchAlreadyExists: false,
  }),
}));

const { useWorkspaceConfig } =
  await import('../../api/browser/create-task-modal/use-workspace-config');

let latestState: WorkspaceConfigState | undefined;

function Probe({
  initial,
  isUnborn = false,
  hasRepository = true,
}: {
  initial: Parameters<typeof useWorkspaceConfig>[0]['initial'];
  isUnborn?: boolean;
  hasRepository?: boolean;
}) {
  latestState = useWorkspaceConfig({
    projectId: 'project-1',
    defaultBranch: { type: 'local', branch: 'main' },
    isUnborn,
    hasRepository,
    currentBranch: 'current-branch',
    repositoryWorkspaceId: 'repo-workspace-1',
    pr: null,
    taskName: 'Generated task branch',
    linkedIssue: null,
    createBranchAndWorktreeDefault: true,
    resetKey: 'project-1',
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
    options: { isUnborn?: boolean; hasRepository?: boolean } = {}
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
      pushBranch: false,
    });
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

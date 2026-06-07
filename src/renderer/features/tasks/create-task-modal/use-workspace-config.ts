import { useMemo, useState } from 'react';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import type { Branch } from '@shared/core/git/git';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import { buildWorkspaceConfigFromPreset } from '@shared/core/workspaces/build-workspace-config-from-preset';
import { describeSetupSteps } from '@shared/core/workspaces/describe-setup-steps';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import type { WorkspacePresetId } from '@shared/core/workspaces/workspace-presets';
import { compileSetupSpec } from '@shared/core/workspaces/workspace-setup-spec';
import { useBranchName, type BranchNameState } from './use-branch-name';
import { useBranchSelection, type BranchSelectionState } from './use-branch-selection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Top-level workspace creation mode — drives which detail panel is shown. */
export type WorkspaceMode = 'new-worktree' | 'existing' | 'sandbox';

export type WorkspaceConfigState = {
  // ── Mode & preset ──────────────────────────────────────────────────────
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
  /** The active preset within the current mode. Changing mode resets this. */
  presetId: WorkspacePresetId;
  setPresetId: (id: WorkspacePresetId) => void;

  // ── New-worktree detail ─────────────────────────────────────────────────
  branchSelection: BranchSelectionState;
  branchNameState: BranchNameState;

  // ── Existing-workspace detail ───────────────────────────────────────────
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (id: string | null) => void;

  // ── Derived ────────────────────────────────────────────────────────────
  /** The resolved WorkspaceConfig to pass to createTask. */
  resolvedConfig: WorkspaceConfig;
  /** Human-readable git steps that will run at provision time. */
  setupSteps: string[];
  /** Whether enough information is present to submit the form. */
  isValid: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultPresetForMode(mode: WorkspaceMode, hasPR: boolean): WorkspacePresetId {
  switch (mode) {
    case 'existing':
      return 'use-existing';
    case 'sandbox':
      return 'sandbox';
    case 'new-worktree':
      return hasPR ? 'checkout-pr' : 'new-branch';
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type WorkspaceConfigInitial = {
  mode?: WorkspaceMode;
  presetId?: WorkspacePresetId;
  selectedWorkspaceId?: string | null;
};

export function useWorkspaceConfig(opts: {
  projectId: string | undefined;
  defaultBranch: Branch | undefined;
  isUnborn: boolean;
  currentBranch: string | null;
  repositoryWorkspaceId: string | null | undefined;
  pr: PullRequest | null;
  taskName: string;
  linkedIssue: LinkedIssue | null;
  createBranchAndWorktreeDefault?: boolean;
  resetKey?: unknown;
  initial?: WorkspaceConfigInitial;
}): WorkspaceConfigState {
  const {
    projectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    repositoryWorkspaceId,
    pr,
    taskName,
    linkedIssue,
    createBranchAndWorktreeDefault = true,
    resetKey,
    initial,
  } = opts;

  const hasPR = !!pr;
  const [mode, setModeRaw] = useState<WorkspaceMode>(initial?.mode ?? 'new-worktree');
  const [presetId, setPresetIdRaw] = useState<WorkspacePresetId>(
    () => initial?.presetId ?? defaultPresetForMode(initial?.mode ?? 'new-worktree', hasPR)
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    initial?.selectedWorkspaceId ?? null
  );

  // Reset when the project changes.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setModeRaw('new-worktree');
    setPresetIdRaw(defaultPresetForMode('new-worktree', hasPR));
    setSelectedWorkspaceId(null);
  }

  // When a PR becomes available or is removed, update the preset if still on default.
  const [prevHasPR, setPrevHasPR] = useState(hasPR);
  if (hasPR !== prevHasPR) {
    setPrevHasPR(hasPR);
    if (mode === 'new-worktree') {
      setPresetIdRaw(defaultPresetForMode('new-worktree', hasPR));
    }
  }

  const setMode = (next: WorkspaceMode) => {
    setModeRaw(next);
    setPresetIdRaw(defaultPresetForMode(next, hasPR));
    if (next !== 'existing') setSelectedWorkspaceId(null);
  };

  const setPresetId = (id: WorkspacePresetId) => {
    setPresetIdRaw(id);
  };

  // ── Inner hooks ──────────────────────────────────────────────────────────

  const branchSelection = useBranchSelection(
    projectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    undefined,
    createBranchAndWorktreeDefault
  );

  const branchNameState = useBranchName({
    taskName,
    linkedIssue,
    projectId,
    resetKey,
  });

  // ── Resolved config ──────────────────────────────────────────────────────

  const resolvedConfig = useMemo((): WorkspaceConfig => {
    try {
      return buildWorkspaceConfigFromPreset(
        presetId,
        {
          defaultBranch,
          currentBranch: currentBranch ?? undefined,
          pr: pr ?? undefined,
          repositoryWorkspaceId: repositoryWorkspaceId ?? undefined,
          existingWorkspaceId: selectedWorkspaceId ?? undefined,
        },
        {
          branchName: branchNameState.branchName,
          fromBranch: branchSelection.selectedBranch,
          pushBranch: branchSelection.pushBranch,
          taskBranch: branchNameState.branchName,
        }
      );
    } catch {
      // Return a safe fallback when context is incomplete (e.g. PR not yet selected).
      return {
        version: '2',
        git: { kind: 'none' },
        workspace: repositoryWorkspaceId
          ? { kind: 'repository-instance', workspaceId: repositoryWorkspaceId }
          : { kind: 'new-worktree' },
      };
    }
  }, [
    presetId,
    defaultBranch,
    currentBranch,
    pr,
    repositoryWorkspaceId,
    selectedWorkspaceId,
    branchNameState.branchName,
    branchSelection.selectedBranch,
    branchSelection.pushBranch,
  ]);

  // ── Setup steps ───────────────────────────────────────────────────────────

  const setupSteps = useMemo((): string[] => {
    const repo = projectId ? getRepositoryStore(projectId) : undefined;
    const baseRemote = repo?.baseRemote?.name ?? 'origin';
    const pushRemote = repo?.pushRemote?.name ?? 'origin';
    // compileSetupSpec still uses the legacy WorkspaceLocation format.
    // For step-preview purposes: new-worktree → host:local, byoi → host:byoi, otherwise no steps.
    const git = resolvedConfig.git;
    const wsTarget = resolvedConfig.workspace;
    if (wsTarget.kind === 'repository-instance' || git.kind === 'none') return [];
    const location =
      wsTarget.kind === 'byoi' ? { host: 'byoi' as const } : { host: 'local' as const };
    const spec = compileSetupSpec(git, location, { baseRemote, pushRemote });
    return describeSetupSteps(spec);
  }, [resolvedConfig, projectId]);

  // ── Validity ─────────────────────────────────────────────────────────────

  const isValid = useMemo((): boolean => {
    if (mode === 'sandbox') return true;

    if (mode === 'existing') {
      return !!(selectedWorkspaceId || repositoryWorkspaceId);
    }

    // new-worktree
    if (presetId === 'checkout-pr' || presetId === 'pr-new-branch') {
      if (!pr) return false;
      if (presetId === 'pr-new-branch') {
        return branchNameState.branchName.trim().length > 0 && !branchNameState.branchAlreadyExists;
      }
      return true;
    }

    // new-branch
    if (isUnborn) return true;
    return (
      branchNameState.branchName.trim().length > 0 &&
      !branchNameState.branchAlreadyExists &&
      branchSelection.selectedBranch !== undefined
    );
  }, [
    mode,
    presetId,
    pr,
    isUnborn,
    selectedWorkspaceId,
    repositoryWorkspaceId,
    branchNameState.branchName,
    branchNameState.branchAlreadyExists,
    branchSelection.selectedBranch,
  ]);

  return {
    mode,
    setMode,
    presetId,
    setPresetId,
    branchSelection,
    branchNameState,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    resolvedConfig,
    setupSteps,
    isValid,
  };
}

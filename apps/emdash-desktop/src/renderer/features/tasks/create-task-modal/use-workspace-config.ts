import type { GitBranchRef } from '@emdash/core/git';
import { useMemo, useState } from 'react';
import { getGitRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { useProjectWorkspaces } from '@renderer/features/tasks/task-config/existing-workspace-picker';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import { buildWorkspaceConfigFromPreset } from '@shared/core/workspaces/build-workspace-config-from-preset';
import { describeSetupSteps } from '@shared/core/workspaces/describe-setup-steps';
import type { ProjectWorkspace } from '@shared/core/workspaces/project-workspace';
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
  /**
   * When the user picks "Checkout branch" in the new-worktree preset and the
   * chosen branch is already checked out in another worktree, this holds the
   * conflicting workspace so the UI can warn and offer a CTA.
   */
  branchConflict: ProjectWorkspace | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives the effective branch name from a workspace's stored config, mirroring
 * `deriveBranchName` from the main process. Used when the `branchName` DB column
 * is null (i.e. the workspace has not been provisioned yet).
 */
function getConfigBranchName(config: WorkspaceConfig | null): string | null {
  if (!config) return null;
  const { git } = config;
  if (git.kind === 'use-branch' || git.kind === 'create-branch') return git.branchName;
  if (git.kind === 'pr-branch') return git.taskBranch ?? git.headBranch;
  return null;
}

/**
 * Strips a leading "remote/" prefix from a branch name, normalizing legacy rows
 * where the remote name was included (e.g. "origin/main" → "main").
 */
function stripRemotePrefix(name: string): string {
  const slash = name.indexOf('/');
  return slash !== -1 ? name.slice(slash + 1) : name;
}

function defaultPresetForMode(mode: WorkspaceMode, hasPR: boolean): WorkspacePresetId {
  switch (mode) {
    case 'existing':
      return 'use-existing';
    case 'sandbox':
      return 'sandbox';
    case 'new-worktree':
      return hasPR ? 'checkout-pr' : 'new-worktree';
  }
}

/** Derives the WorkspaceMode that owns a given preset. */
export function modeForPreset(id: WorkspacePresetId): WorkspaceMode {
  switch (id) {
    case 'new-worktree':
    case 'checkout-pr':
    case 'pr-new-branch':
      return 'new-worktree';
    case 'repo-root':
    case 'use-existing':
      return 'existing';
    case 'sandbox':
      return 'sandbox';
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
  defaultBranch: GitBranchRef | undefined;
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

  // When a PR becomes available or is removed, always update the preset.
  const [prevHasPR, setPrevHasPR] = useState(hasPR);
  if (hasPR !== prevHasPR) {
    setPrevHasPR(hasPR);
    if (hasPR) {
      setModeRaw('new-worktree');
      setPresetIdRaw('checkout-pr');
    } else if (presetId === 'checkout-pr' || presetId === 'pr-new-branch') {
      setModeRaw('new-worktree');
      setPresetIdRaw('new-worktree');
    }
  }

  const setMode = (next: WorkspaceMode) => {
    setModeRaw(next);
    setPresetIdRaw(defaultPresetForMode(next, hasPR));
    if (next !== 'existing') setSelectedWorkspaceId(null);
  };

  const setPresetId = (id: WorkspacePresetId) => {
    setPresetIdRaw(id);
    setModeRaw(modeForPreset(id));
    // Clear selected workspace when leaving 'existing' presets.
    if (modeForPreset(id) !== 'existing') setSelectedWorkspaceId(null);
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
          createBranch: branchSelection.createBranchAndWorktree,
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
    branchSelection.createBranchAndWorktree,
    branchNameState.branchName,
    branchSelection.selectedBranch,
    branchSelection.pushBranch,
  ]);

  // ── Setup steps ───────────────────────────────────────────────────────────

  const setupSteps = useMemo((): string[] => {
    const repo = projectId ? getGitRepositoryStore(projectId) : undefined;
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

  // ── Branch conflict ───────────────────────────────────────────────────────

  const { data: projectWorkspaces = [] } = useProjectWorkspaces(projectId);

  const branchConflict = useMemo((): ProjectWorkspace | null => {
    if (presetId !== 'new-worktree' || branchSelection.createBranchAndWorktree) return null;
    const selectedName = branchSelection.selectedBranch?.branch;
    if (!selectedName) return null;

    return (
      projectWorkspaces.find((ws) => {
        if (ws.kind === 'project-root') return false;
        // branchName column is null until the workspace is first provisioned; fall
        // back to deriving it from the stored WorkspaceConfig.
        const effective = ws.branchName ?? getConfigBranchName(ws.config);
        if (!effective) return false;
        // Normalize away a possible "remote/" prefix (e.g. "origin/main" → "main")
        // that may appear in legacy workspace rows.
        return effective === selectedName || stripRemotePrefix(effective) === selectedName;
      }) ?? null
    );
  }, [
    presetId,
    branchSelection.createBranchAndWorktree,
    branchSelection.selectedBranch,
    projectWorkspaces,
  ]);

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

    // new-worktree — checkout existing branch
    if (!branchSelection.createBranchAndWorktree) {
      return branchSelection.selectedBranch !== undefined && !branchConflict;
    }

    // new-worktree — create new branch
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
    branchSelection.createBranchAndWorktree,
    branchConflict,
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
    branchConflict,
  };
}

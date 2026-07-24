import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import { useMemo, useState } from 'react';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { useProjectWorkspaces } from '@core/features/tasks/browser/task-config/existing-workspace-picker';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { buildWorkspaceConfigFromPreset } from '@core/primitives/workspaces/api';
import { describeSetupSteps } from '@core/primitives/workspaces/api';
import type { ProjectWorkspace } from '@core/primitives/workspaces/api';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { WorkspacePresetId } from '@core/primitives/workspaces/api';
import { compileSetupSpec } from '@core/primitives/workspaces/api';
import type { PullRequest } from '@root/src/core/services/pull-requests/api';
import {
  useBranchName,
  type BranchNameState,
} from '../../../browser/create-task-modal/use-branch-name';
import {
  useBranchSelection,
  type BranchSelectionInitial,
  type BranchSelectionState,
} from '../../../browser/create-task-modal/use-branch-selection';

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

function presetRequiresCommits(id: WorkspacePresetId): boolean {
  return id === 'new-worktree' || id === 'checkout-pr' || id === 'pr-new-branch';
}

function defaultMode(
  worktreesDisabled: boolean,
  initialMode: WorkspaceMode | undefined
): WorkspaceMode {
  if (worktreesDisabled) return 'existing';
  return initialMode ?? 'new-worktree';
}

function defaultPreset(opts: {
  mode: WorkspaceMode;
  hasPR: boolean;
  worktreesDisabled: boolean;
  initialPresetId?: WorkspacePresetId;
}): WorkspacePresetId {
  if (opts.worktreesDisabled) {
    if (opts.initialPresetId && !presetRequiresCommits(opts.initialPresetId)) {
      return opts.initialPresetId;
    }
    return 'repo-root';
  }
  return opts.initialPresetId ?? defaultPresetForMode(opts.mode, opts.hasPR);
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
  branchSelection?: BranchSelectionInitial;
};

export function useWorkspaceConfig(opts: {
  projectId: string | undefined;
  defaultBranch: GitBranchRef | undefined;
  isUnborn: boolean;
  hasRepository?: boolean;
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
    hasRepository = true,
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
  const worktreesDisabled = isUnborn || !hasRepository;
  const initialMode = defaultMode(worktreesDisabled, initial?.mode);
  const [mode, setModeRaw] = useState<WorkspaceMode>(initialMode);
  const [presetId, setPresetIdRaw] = useState<WorkspacePresetId>(() =>
    defaultPreset({
      mode: initialMode,
      hasPR,
      worktreesDisabled,
      initialPresetId: initial?.presetId,
    })
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    initial?.selectedWorkspaceId ?? null
  );

  // Reset when the project changes.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    const nextMode = defaultMode(worktreesDisabled, undefined);
    setModeRaw(nextMode);
    setPresetIdRaw(defaultPreset({ mode: nextMode, hasPR, worktreesDisabled }));
    setSelectedWorkspaceId(null);
  }

  const [prevWorktreesDisabled, setPrevWorktreesDisabled] = useState(worktreesDisabled);
  if (worktreesDisabled !== prevWorktreesDisabled) {
    setPrevWorktreesDisabled(worktreesDisabled);
    if (worktreesDisabled && presetRequiresCommits(presetId)) {
      setModeRaw('existing');
      setPresetIdRaw('repo-root');
      setSelectedWorkspaceId(null);
    }
  }

  // When a PR becomes available or is removed, always update the preset.
  const [prevHasPR, setPrevHasPR] = useState(hasPR);
  if (hasPR !== prevHasPR) {
    setPrevHasPR(hasPR);
    if (hasPR) {
      if (!worktreesDisabled) {
        setModeRaw('new-worktree');
        setPresetIdRaw('checkout-pr');
      }
    } else if (presetId === 'checkout-pr' || presetId === 'pr-new-branch') {
      const nextMode = defaultMode(worktreesDisabled, undefined);
      setModeRaw(nextMode);
      setPresetIdRaw(defaultPreset({ mode: nextMode, hasPR: false, worktreesDisabled }));
    }
  }

  const setMode = (next: WorkspaceMode) => {
    const normalizedMode = worktreesDisabled && next === 'new-worktree' ? 'existing' : next;
    setModeRaw(normalizedMode);
    setPresetIdRaw(defaultPreset({ mode: normalizedMode, hasPR, worktreesDisabled }));
    if (normalizedMode !== 'existing') setSelectedWorkspaceId(null);
  };

  const setPresetId = (id: WorkspacePresetId) => {
    const normalizedId = worktreesDisabled && presetRequiresCommits(id) ? 'repo-root' : id;
    setPresetIdRaw(normalizedId);
    setModeRaw(modeForPreset(normalizedId));
    // Clear selected workspace when leaving 'existing' presets.
    if (modeForPreset(normalizedId) !== 'existing') setSelectedWorkspaceId(null);
  };

  // ── Inner hooks ──────────────────────────────────────────────────────────

  const branchSelection = useBranchSelection(
    projectId,
    defaultBranch,
    currentBranch,
    isUnborn,
    initial?.branchSelection,
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
    return (
      branchNameState.branchName.trim().length > 0 &&
      !branchNameState.branchAlreadyExists &&
      branchSelection.selectedBranch !== undefined
    );
  }, [
    mode,
    presetId,
    pr,
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

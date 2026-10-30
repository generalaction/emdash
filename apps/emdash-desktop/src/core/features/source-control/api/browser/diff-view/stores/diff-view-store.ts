import type { GitObjectRef } from '@emdash/core/runtimes/git/api';
import { createScope } from '@emdash/shared/concurrency';
import { observe, pin } from '@emdash/wire/state';
import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import type { GitRepositoryStore } from '@core/features/source-control/api/browser/stores/git-repository-store';
import type { PrStore } from '@core/features/source-control/api/browser/stores/pr-store';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import type {
  TaskDiffPreferencesState,
  TaskDiffSelectionState,
  ActiveFile,
} from '@core/features/tasks/contributions/mementos';
import type { WorkspaceStore } from '@core/features/workspaces/api/browser/stores/workspace';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import { getWorkspaceGroupsRemote } from '@core/features/workspaces/api/browser/use-workspace-groups';
import { commitRef } from '@core/primitives/git/api';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import {
  projectWorkspaceOpenInTaskDisabledReason,
  type ProjectWorkspaceRow,
} from '@core/primitives/workspaces/api';
import { ChangesViewStore } from '../../../../browser/diff-view/stores/changes-view-store';
import { type GitCheckoutStore } from '../../../../browser/stores/git-checkout-store';

export const MAX_STACKED_FILES = 8;

type CommitAction = 'commit' | 'commit-push' | 'commit-pr';

const VALID_OBJECT_REF_KINDS = new Set(['branch', 'commit', 'tag']);

function isValidGitObjectRef(raw: unknown): raw is GitObjectRef {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    VALID_OBJECT_REF_KINDS.has((raw as Record<string, unknown>)['kind'] as string)
  );
}

export class DiffViewStore {
  readonly viewMode = 'file' as const;

  readonly changesView: ChangesViewStore;
  worktrees: ProjectWorkspaceRow[] = [];
  worktreesLoading = false;
  worktreesError: string | null = null;
  inspectionNotice: string | null = null;
  private selectedId: string;
  private readonly inspectedWorkspaces = observable.map<string, WorkspaceStore>([], {
    deep: false,
  });
  private readonly tabWorkspaceRefs = new Map<string, number>();
  private readonly scope = createScope({ label: 'diff-worktrees' });
  private disposed = false;

  /**
   * Index of the override file within its source list at the time it was set.
   * Used as a position hint when the file disappears so we can select a neighbor
   * rather than always falling back to the first file. Not observable — always
   * updated atomically with activeFileOverride inside setActiveFile.
   */
  private _activeFileOverrideIndex = -1;

  private _disposeReactions: Array<() => void> = [];

  constructor(
    private readonly taskGitCheckout: GitCheckoutStore,
    private readonly pr: PrStore,
    private readonly preferencesHandle: MementoHandle<TaskDiffPreferencesState>,
    private readonly selectionHandle: MementoHandle<TaskDiffSelectionState>,
    private readonly context: {
      projectId: string;
      taskId: string;
      workspace: WorkspaceStore;
      gitRepository: GitRepositoryStore;
    }
  ) {
    this.selectedId = context.workspace.workspaceId;
    makeObservable<DiffViewStore, 'preferencesHandle' | 'selectionHandle' | 'selectedId'>(this, {
      worktrees: observable.ref,
      worktreesLoading: observable,
      worktreesError: observable,
      inspectionNotice: observable,
      selectedId: observable,
      selectedWorkspaceId: computed,
      workspace: computed,
      gitCheckout: computed,
      readOnly: computed,
      activeFileOverride: computed,
      activeFile: computed,
      effectivePrTab: computed,
      diffStyle: computed,
      commitAction: computed,
      prTab: computed,
      setActiveFile: action,
      setDiffStyle: action,
      setPrTab: action,
      preferencesHandle: false,
      selectionHandle: false,
    });
    // Bind reactions after checkout selection is observable, including when
    // the task's Git status finished loading before this view was created.
    this.changesView = new ChangesViewStore(() => this.gitCheckout, pr, {
      get value() {
        return preferencesHandle.value.expandedSections;
      },
      set: (next) => {
        preferencesHandle.update((current) => ({ ...current, expandedSections: next }));
      },
    });
    if (!context.workspace.sshConnectionId) void this.startWorktrees();

    // Reset PR tab when the current PR changes (different PR URL).
    this._disposeReactions.push(
      reaction(
        () => this.pr.currentPr?.url,
        () => {
          this.setPrTab(this.pr.currentPr?.status === 'open' ? 'files' : 'commits');
        }
      )
    );

    // Auto-expand the changes panel section that contains the newly selected file.
    this._disposeReactions.push(
      reaction(
        () => this.activeFile,
        (file) => {
          if (!file || file.group === 'git' || file.group === 'pr') return;
          this.changesView.expandForActiveFileType(file.group);
        }
      )
    );
  }

  get taskWorkspaceId(): string {
    return this.context.workspace.workspaceId;
  }

  get projectId(): string {
    return this.context.projectId;
  }

  get taskId(): string {
    return this.context.taskId;
  }

  get selectedWorkspaceId(): string {
    return this.selectedId;
  }

  get workspace(): WorkspaceStore {
    return this.workspaceFor(this.selectedId) ?? this.context.workspace;
  }

  get gitCheckout(): GitCheckoutStore {
    return this.selectedId === this.taskWorkspaceId
      ? this.taskGitCheckout
      : this.workspace.get(gitCheckoutStoreToken);
  }

  get readOnly(): boolean {
    return this.selectedId !== this.taskWorkspaceId;
  }

  workspaceFor(workspaceId: string): WorkspaceStore | undefined {
    return workspaceId === this.taskWorkspaceId
      ? this.context.workspace
      : this.inspectedWorkspaces.get(workspaceId);
  }

  retainWorkspace(workspaceId: string): void {
    this.tabWorkspaceRefs.set(workspaceId, (this.tabWorkspaceRefs.get(workspaceId) ?? 0) + 1);
    this.acquireWorkspace(workspaceId);
  }

  releaseWorkspace(workspaceId: string): void {
    const count = (this.tabWorkspaceRefs.get(workspaceId) ?? 0) - 1;
    if (count > 0) this.tabWorkspaceRefs.set(workspaceId, count);
    else this.tabWorkspaceRefs.delete(workspaceId);
    this.releaseUnusedWorkspaces();
  }

  selectWorkspace(workspaceId: string): void {
    if (workspaceId !== this.taskWorkspaceId && !this.acquireWorkspace(workspaceId)) return;
    if (workspaceId === this.selectedId) return;
    runInAction(() => {
      this.selectedId = workspaceId;
      this.inspectionNotice = null;
      this.changesView.clearSelections();
      this.selectionHandle.update((current) => ({
        ...current,
        selectedWorkspaceId: workspaceId,
        activeFile: undefined,
      }));
      this._activeFileOverrideIndex = -1;
    });
    this.releaseUnusedWorkspaces();
  }

  private acquireWorkspace(workspaceId: string): WorkspaceStore | undefined {
    const existing = this.workspaceFor(workspaceId);
    if (existing) return existing;
    const row = this.worktrees.find((candidate) => candidate.workspaceId === workspaceId);
    if (!row || projectWorkspaceOpenInTaskDisabledReason(row)) return undefined;
    const workspace = workspaceRegistry.acquire({
      projectId: this.context.projectId,
      workspaceId,
      path: row.path,
      gitRepository: this.context.gitRepository,
    });
    runInAction(() => this.inspectedWorkspaces.set(workspaceId, workspace));
    workspaceRegistry.activate(workspaceId);
    return workspace;
  }

  private releaseUnusedWorkspaces(): void {
    for (const [id, workspace] of this.inspectedWorkspaces) {
      if (id === this.selectedId || this.tabWorkspaceRefs.has(id)) continue;
      runInAction(() => this.inspectedWorkspaces.delete(id));
      workspaceRegistry.release(id, workspace);
    }
  }

  private async startWorktrees(): Promise<void> {
    runInAction(() => {
      this.worktreesLoading = true;
    });
    try {
      const remote = await getWorkspaceGroupsRemote();
      if (this.disposed) return;
      const model = remote({ hostKey: 'local' });
      pin(this.scope, [model.states.list]);
      let restored = false;
      observe(
        model.states.list,
        (state) => {
          if (this.disposed) return;
          runInAction(() => {
            if (state.status === 'error') {
              this.worktreesLoading = false;
              this.worktreesError = String(state.error);
              return;
            }
            if (!state.value) return;
            const group = state.value.groups.find(
              (candidate) => candidate.project.id === this.context.projectId
            );
            const root = group?.workspaces.find((row) => row.kind === 'root');
            this.worktrees = (group?.workspaces ?? []).filter(
              (row) =>
                !!root?.workspaceId &&
                !!row.workspaceId &&
                (row.workspaceId === root?.workspaceId || row.parentId === root?.workspaceId)
            );
            this.worktreesLoading = false;
            this.worktreesError = null;
            for (const [id, workspace] of this.inspectedWorkspaces) {
              const row = this.worktrees.find((candidate) => candidate.workspaceId === id);
              if (
                !row ||
                projectWorkspaceOpenInTaskDisabledReason(row) ||
                row.path !== workspace.path
              ) {
                this.inspectedWorkspaces.delete(id);
                workspaceRegistry.release(id, workspace);
              }
            }
            for (const id of this.tabWorkspaceRefs.keys()) this.acquireWorkspace(id);
            if (!restored) {
              restored = true;
              const savedId = this.selectionHandle.value.selectedWorkspaceId;
              if (savedId && savedId !== this.taskWorkspaceId) {
                if (this.acquireWorkspace(savedId)) this.selectedId = savedId;
                else this.inspectionNotice = 'The saved worktree is no longer available.';
              }
            }
            if (
              this.selectedId !== this.taskWorkspaceId &&
              !this.acquireWorkspace(this.selectedId)
            ) {
              this.selectWorkspace(this.taskWorkspaceId);
              this.inspectionNotice = 'The inspected worktree is no longer available.';
            }
          });
        },
        { scope: this.scope }
      );
    } catch (error) {
      if (this.disposed) return;
      runInAction(() => {
        this.worktreesLoading = false;
        this.worktreesError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  get activeFileOverride(): ActiveFile | null {
    return (this.selectionHandle.value.activeFile as ActiveFile | undefined) ?? null;
  }

  get diffStyle(): 'unified' | 'split' {
    return this.preferencesHandle.value.diffStyle;
  }

  get commitAction(): CommitAction | null {
    return this.preferencesHandle.value.commitAction;
  }

  get prTab(): 'files' | 'commits' | 'checks' {
    return this.preferencesHandle.value.prTab;
  }

  /**
   * The effective active file. Derived from activeFileOverride by validating it
   * against the current working-tree lists. Falls back to a neighbor or the
   * default file when the override is stale. Always consistent with observable
   * state — no reaction needed.
   */
  get activeFile(): ActiveFile | null {
    const override = this.activeFileOverride;
    if (!override) return this._defaultActiveFile;
    if (override.workspaceId && override.workspaceId !== this.selectedId)
      return this._defaultActiveFile;

    // git/pr groups cannot be validated against working-tree lists — trust the override
    if (override.group === 'git' || override.group === 'pr') return override;

    const isStaged = override.group === 'staged';
    const ownList = isStaged
      ? this.gitCheckout.stagedFileChanges
      : this.gitCheckout.unstagedFileChanges;
    const otherList = isStaged
      ? this.gitCheckout.unstagedFileChanges
      : this.gitCheckout.stagedFileChanges;

    // Override is still valid
    if (ownList.some((f) => f.path === override.path)) return override;

    // File moved to the other list (staged/unstaged while active)
    if (otherList.some((f) => f.path === override.path)) {
      return {
        ...override,
        type: isStaged ? 'disk' : 'git',
        group: isStaged ? 'disk' : 'staged',
        originalRef: commitRef('HEAD'),
      };
    }

    // File completely gone — select position-based neighbor within the same group
    const idx = Math.max(0, this._activeFileOverrideIndex);
    const neighbor = ownList[Math.min(idx, ownList.length - 1)];
    if (neighbor) return { ...override, path: neighbor.path };

    // Same-group list is now empty — fall back to first file in the other group
    if (otherList.length > 0) {
      return {
        ...override,
        path: otherList[0]!.path,
        type: isStaged ? 'disk' : 'git',
        group: isStaged ? 'disk' : 'staged',
        originalRef: commitRef('HEAD'),
      };
    }

    return null;
  }

  get effectivePrTab(): 'files' | 'commits' | 'checks' {
    if (this.pr.currentPr?.status !== 'open' && this.prTab === 'files') {
      return 'commits';
    }
    return this.prTab;
  }

  get effectiveCommitAction(): CommitAction {
    if (this.commitAction !== null) return this.commitAction;
    return this.gitCheckout.isPublished ? 'commit-push' : 'commit';
  }

  setCommitAction(action: CommitAction | null): void {
    this.preferencesHandle.update((current) => ({ ...current, commitAction: action }));
  }

  setActiveFile(file: ActiveFile | null): void {
    if (file && !isValidGitObjectRef(file.originalRef)) return;
    if (file) {
      const workspaceId = file.workspaceId ?? this.taskWorkspaceId;
      this.selectWorkspace(workspaceId);
      if (workspaceId !== this.selectedId) return;
    }
    this.selectionHandle.update((current) => ({
      ...current,
      activeFile: file ?? undefined,
    }));
    if (file?.group === 'disk' || file?.group === 'staged') {
      const list =
        file.group === 'staged'
          ? this.gitCheckout.stagedFileChanges
          : this.gitCheckout.unstagedFileChanges;
      this._activeFileOverrideIndex = list.findIndex((f) => f.path === file.path);
    } else {
      this._activeFileOverrideIndex = -1;
    }
  }

  setDiffStyle(style: 'unified' | 'split'): void {
    this.preferencesHandle.update((current) => ({ ...current, diffStyle: style }));
  }

  setPrTab(tab: 'files' | 'commits' | 'checks'): void {
    this.preferencesHandle.update((current) => ({ ...current, prTab: tab }));
  }

  dispose(): void {
    this.disposed = true;
    void this.scope.dispose();
    for (const dispose of this._disposeReactions) dispose();
    this._disposeReactions = [];
    this.changesView.dispose();
    for (const [id, workspace] of this.inspectedWorkspaces)
      workspaceRegistry.release(id, workspace);
    this.inspectedWorkspaces.clear();
    this.tabWorkspaceRefs.clear();
  }

  private get _defaultActiveFile(): ActiveFile | null {
    const first = this.gitCheckout.unstagedFileChanges[0] ?? this.gitCheckout.stagedFileChanges[0];
    if (!first) return null;
    const isUnstaged = !!this.gitCheckout.unstagedFileChanges[0];
    return {
      workspaceId: this.selectedId,
      path: first.path,
      type: isUnstaged ? 'disk' : 'git',
      group: isUnstaged ? 'disk' : 'staged',
      originalRef: commitRef('HEAD'),
    };
  }
}

import { action, makeObservable, observable, reaction, runInAction } from 'mobx';
import type { ActiveFile, DiffViewSnapshot } from '@shared/view-state';
import { ChangesViewStore } from '@renderer/features/tasks/diff-view/stores/changes-view-store';
import type { PrStore } from '@renderer/features/tasks/stores/pr-store';
import { Snapshottable } from '@renderer/lib/stores/snapshottable';
import { GitStore } from './git';

/**
 * Maximum number of files that the stacked diff view can handle.
 * When the current diff context exceeds this limit the store automatically
 * switches to file mode and disables the stacked toggle.
 */
export const MAX_STACKED_FILES = 75;

export class DiffViewStore implements Snapshottable<DiffViewSnapshot> {
  activeFile: ActiveFile | null = null;
  diffStyle: 'unified' | 'split' = 'unified';
  viewMode: 'stacked' | 'file' = 'stacked';
  commitAction: 'commit' | 'commit-push' | null = null;
  /**
   * True when the current diff context has more files than MAX_STACKED_FILES.
   * The stacked view toggle is disabled in the UI while this is true.
   * Auto-set to 'file' viewMode when it becomes true; does NOT reset viewMode
   * when it becomes false again (user must switch back manually).
   */
  stackedDiffDisabled = false;

  readonly changesView: ChangesViewStore;

  private _disposeReactions: Array<() => void> = [];

  constructor(
    private readonly git: GitStore,
    private readonly pr: PrStore
  ) {
    this.changesView = new ChangesViewStore(git, pr);

    makeObservable(this, {
      activeFile: observable,
      diffStyle: observable,
      viewMode: observable,
      stackedDiffDisabled: observable,
      commitAction: observable,
      setActiveFile: action,
      setDiffStyle: action,
      setViewMode: action,
    });

    // Sync activeFile when staged/unstaged lists change (replaces ActiveFileSync component).
    // Files with type='git' are not in working-tree lists and are left unchanged.
    this._disposeReactions.push(
      reaction(
        () => ({
          staged: this.git.stagedFileChanges,
          unstaged: this.git.unstagedFileChanges,
        }),
        ({ staged, unstaged }) => {
          const current = this.activeFile;
          if (!current || current.type === 'git') return;

          const isStaged = current.type === 'staged';
          const inCurrentList = (isStaged ? staged : unstaged).some((f) => f.path === current.path);
          if (inCurrentList) return;

          const movedToStaged = staged.some((f) => f.path === current.path);
          const movedToUnstaged = unstaged.some((f) => f.path === current.path);

          runInAction(() => {
            if (movedToStaged) {
              this.activeFile = {
                ...current,
                type: 'staged',
                originalRef: 'HEAD',
                scrollBehavior: 'auto',
              };
            } else if (movedToUnstaged) {
              this.activeFile = {
                ...current,
                type: 'disk',
                originalRef: 'HEAD',
                scrollBehavior: 'auto',
              };
            } else {
              this.activeFile = null;
            }
          });
        }
      )
    );

    // Auto-expand the changes panel section that contains the newly selected file.
    this._disposeReactions.push(
      reaction(
        () => this.activeFile,
        (file) => {
          if (!file || file.type === 'git') return;
          this.changesView.expandForActiveFileType(file.type);
        }
      )
    );

    // Enforce MAX_STACKED_FILES: when the current diff context has too many
    // files, force file mode and mark stacked as disabled.
    this._disposeReactions.push(
      reaction(
        () => this._currentFileCount(),
        (count) => {
          runInAction(() => {
            if (count > MAX_STACKED_FILES) {
              this.stackedDiffDisabled = true;
              this.viewMode = 'file';
            } else {
              this.stackedDiffDisabled = false;
              // Do not auto-switch back to stacked — user stays in file view.
            }
          });
        }
      )
    );
  }

  get snapshot(): DiffViewSnapshot {
    return {
      diffStyle: this.diffStyle,
      viewMode: this.viewMode,
      activeFile: this.activeFile ? { ...this.activeFile, scrollBehavior: undefined } : undefined,
      commitAction: this.commitAction,
    };
  }

  restoreSnapshot(snapshot: Partial<DiffViewSnapshot>): void {
    if (snapshot.diffStyle) this.diffStyle = snapshot.diffStyle;
    if (snapshot.viewMode) this.viewMode = snapshot.viewMode;
    if (snapshot.activeFile) this.activeFile = snapshot.activeFile;
    if (snapshot.commitAction) this.commitAction = snapshot.commitAction;
    // Apply limit in case the persisted viewMode is 'stacked' but the file
    // count already exceeds the threshold.
    this._applyStackedLimit();
  }

  get effectiveCommitAction(): 'commit' | 'commit-push' {
    if (this.commitAction !== null) return this.commitAction;
    return this.git.isBranchPublished ? 'commit-push' : 'commit';
  }

  setCommitAction(action: 'commit' | 'commit-push' | null): void {
    this.commitAction = action;
  }

  setActiveFile(file: ActiveFile | null): void {
    this.activeFile = file;
  }

  setDiffStyle(style: 'unified' | 'split'): void {
    this.diffStyle = style;
  }

  setViewMode(mode: 'stacked' | 'file'): void {
    if (mode === 'stacked' && this.stackedDiffDisabled) return;
    this.viewMode = mode;
  }

  dispose(): void {
    for (const dispose of this._disposeReactions) dispose();
    this._disposeReactions = [];
    this.changesView.dispose();
  }

  private _currentFileCount(): number {
    const file = this.activeFile;
    if (!file) return 0;
    if (file.type === 'staged') return this.git.stagedFileChanges.length;
    if (file.type === 'disk') return this.git.unstagedFileChanges.length;
    // 'git' type — look up PR files by the base ref from PrStore.
    const activePr = this.pr.pullRequests.find((p) => p.metadata.baseRefName === file.originalRef);
    return activePr ? (this.pr.getFiles(activePr).data?.length ?? 0) : 0;
  }

  private _applyStackedLimit(): void {
    if (this._currentFileCount() > MAX_STACKED_FILES) {
      this.stackedDiffDisabled = true;
      this.viewMode = 'file';
    }
  }
}

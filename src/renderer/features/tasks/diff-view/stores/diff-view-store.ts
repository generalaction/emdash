import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { HEAD_REF, localRef, remoteRef, STAGED_REF, type GitRef } from '@shared/git';
import type { ActiveFile, DiffViewSnapshot } from '@shared/view-state';
import { ChangesViewStore } from '@renderer/features/tasks/diff-view/stores/changes-view-store';
import type { PrStore } from '@renderer/features/tasks/stores/pr-store';
import { Snapshottable } from '@renderer/lib/stores/snapshottable';
import { GitStore } from './git-store';

export const MAX_STACKED_FILES = 75;

/** Migrate persisted snapshots where `originalRef` was a plain string. */
function migrateLegacyOriginalRef(legacy: string): GitRef {
  if (legacy === 'HEAD') return HEAD_REF;
  if (legacy === 'staged') return STAGED_REF;
  if (legacy.includes('/')) {
    const idx = legacy.indexOf('/');
    return remoteRef(legacy.slice(0, idx), legacy.slice(idx + 1));
  }
  return localRef(legacy);
}

export class DiffViewStore implements Snapshottable<DiffViewSnapshot> {
  activeFileOverride: ActiveFile | null = null;
  diffStyle: 'unified' | 'split' = 'unified';
  readonly viewMode = 'file' as const;
  commitAction: 'commit' | 'commit-push' | null = null;

  readonly changesView: ChangesViewStore;

  /**
   * Index of the override file within its source list at the time it was set.
   * Used as a position hint when the file disappears so we can select a neighbor
   * rather than always falling back to the first file. Not observable — always
   * updated atomically with activeFileOverride inside setActiveFile.
   */
  private _activeFileOverrideIndex = -1;

  private _disposeReactions: Array<() => void> = [];

  constructor(
    private readonly git: GitStore,
    private readonly pr: PrStore
  ) {
    this.changesView = new ChangesViewStore(git, pr);

    makeObservable(this, {
      activeFileOverride: observable,
      activeFile: computed,
      diffStyle: observable,
      commitAction: observable,
      setActiveFile: action,
      setDiffStyle: action,
    });

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

  /**
   * The effective active file. Derived from activeFileOverride by validating it
   * against the current working-tree lists. Falls back to a neighbor or the
   * default file when the override is stale. Always consistent with observable
   * state — no reaction needed.
   */
  get activeFile(): ActiveFile | null {
    const override = this.activeFileOverride;
    if (!override) return this._defaultActiveFile;

    // git/pr groups cannot be validated against working-tree lists — trust the override
    if (override.group === 'git' || override.group === 'pr') return override;

    const isStaged = override.group === 'staged';
    const ownList = isStaged ? this.git.stagedFileChanges : this.git.unstagedFileChanges;
    const otherList = isStaged ? this.git.unstagedFileChanges : this.git.stagedFileChanges;

    // Override is still valid
    if (ownList.some((f) => f.path === override.path)) return override;

    // File moved to the other list (staged/unstaged while active)
    if (otherList.some((f) => f.path === override.path)) {
      return {
        ...override,
        type: isStaged ? 'disk' : 'git',
        group: isStaged ? 'disk' : 'staged',
        originalRef: HEAD_REF,
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
        originalRef: HEAD_REF,
      };
    }

    return null;
  }

  get snapshot(): DiffViewSnapshot {
    return {
      diffStyle: this.diffStyle,
      viewMode: 'file',
      activeFile: this.activeFileOverride ?? undefined,
      commitAction: this.commitAction,
    };
  }

  restoreSnapshot(snapshot: Partial<DiffViewSnapshot>): void {
    if (snapshot.diffStyle) this.diffStyle = snapshot.diffStyle;
    // viewMode is always 'file' — ignore any persisted value
    if (snapshot.activeFile) {
      const af = { ...snapshot.activeFile };
      if (typeof (af.originalRef as unknown) === 'string') {
        af.originalRef = migrateLegacyOriginalRef(af.originalRef as unknown as string);
      }
      this.activeFileOverride = af;
      // Index is unknown on restore; 0 means we pick the first file if the
      // restored path is gone from the list.
      this._activeFileOverrideIndex = 0;
    }
    if (snapshot.commitAction) this.commitAction = snapshot.commitAction;
  }

  get effectiveCommitAction(): 'commit' | 'commit-push' {
    if (this.commitAction !== null) return this.commitAction;
    return this.git.isBranchPublished ? 'commit-push' : 'commit';
  }

  setCommitAction(action: 'commit' | 'commit-push' | null): void {
    this.commitAction = action;
  }

  setActiveFile(file: ActiveFile | null): void {
    this.activeFileOverride = file;
    if (file?.group === 'disk' || file?.group === 'staged') {
      const list =
        file.group === 'staged' ? this.git.stagedFileChanges : this.git.unstagedFileChanges;
      this._activeFileOverrideIndex = list.findIndex((f) => f.path === file.path);
    } else {
      this._activeFileOverrideIndex = -1;
    }
  }

  setDiffStyle(style: 'unified' | 'split'): void {
    this.diffStyle = style;
  }

  dispose(): void {
    for (const dispose of this._disposeReactions) dispose();
    this._disposeReactions = [];
    this.changesView.dispose();
  }

  private get _defaultActiveFile(): ActiveFile | null {
    const first = this.git.unstagedFileChanges[0] ?? this.git.stagedFileChanges[0];
    if (!first) return null;
    const isUnstaged = !!this.git.unstagedFileChanges[0];
    return {
      path: first.path,
      type: isUnstaged ? 'disk' : 'git',
      group: isUnstaged ? 'disk' : 'staged',
      originalRef: HEAD_REF,
    };
  }
}

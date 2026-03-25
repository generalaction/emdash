import { action, makeObservable, observable, reaction, runInAction } from 'mobx';
import { GitStore } from './git';

export interface ActiveFile {
  path: string;
  /**
   * Which model types to use for the diff:
   *   'disk'   — right side = disk:// (working tree); left = git at originalRef
   *   'staged' — right side = git://'staged' (index content); left = git://HEAD
   *   'git'    — right side = git://HEAD; left = git at originalRef (PR / ref diffs)
   */
  type: 'disk' | 'staged' | 'git';
  /** Git ref for the left (original/before) side. For 'staged', always 'HEAD'. */
  originalRef: string;
  scrollBehavior?: 'smooth' | 'auto';
}

export class DiffViewStore {
  activeFile: ActiveFile | null = null;
  diffStyle: 'unified' | 'split' = 'unified';
  viewMode: 'stacked' | 'file' = 'stacked';
  private _disposeReaction: () => void;

  constructor(private readonly git: GitStore) {
    makeObservable(this, {
      activeFile: observable,
      diffStyle: observable,
      viewMode: observable,
      setActiveFile: action,
      setDiffStyle: action,
      setViewMode: action,
    });

    // Sync activeFile when staged/unstaged lists change (replaces ActiveFileSync component).
    // Files with type='git' are not in working-tree lists and are left unchanged.
    this._disposeReaction = reaction(
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
    );
  }

  setActiveFile(file: ActiveFile | null): void {
    this.activeFile = file;
  }

  setDiffStyle(style: 'unified' | 'split'): void {
    this.diffStyle = style;
  }

  setViewMode(mode: 'stacked' | 'file'): void {
    this.viewMode = mode;
  }

  dispose(): void {
    this._disposeReaction();
  }
}

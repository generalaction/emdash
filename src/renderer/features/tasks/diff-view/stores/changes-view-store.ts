import { computed, makeObservable, observable, reaction, runInAction, when } from 'mobx';
import { PrStore } from '@renderer/features/tasks/stores/pr-store';
import { GitStore } from './git-store';

export type SelectionState = 'all' | 'none' | 'partial';

export interface ExpandedSections {
  unstaged: boolean;
  staged: boolean;
  pullRequests: boolean;
}

export class ChangesViewStore {
  unstagedSelection = observable.set<string>();
  stagedSelection = observable.set<string>();
  expandedSections: ExpandedSections = { unstaged: true, staged: true, pullRequests: true };

  private _disposeReactions: Array<() => void> = [];
  private _suppressAutoExpand = new Set<keyof ExpandedSections>();

  constructor(
    private readonly git: GitStore,
    private readonly pr: PrStore
  ) {
    makeObservable(this, {
      expandedSections: observable,
      unstagedSelectionState: computed,
      stagedSelectionState: computed,
    });

    // Prune stale paths from selections whenever the file lists change.
    this._disposeReactions.push(
      reaction(
        () => ({
          unstaged: this.git.unstagedFileChanges.map((c) => c.path),
          staged: this.git.stagedFileChanges.map((c) => c.path),
        }),
        ({ unstaged, staged }) => {
          const unstagedSet = new Set(unstaged);
          const stagedSet = new Set(staged);
          runInAction(() => {
            for (const p of this.unstagedSelection) {
              if (!unstagedSet.has(p)) this.unstagedSelection.delete(p);
            }
            for (const p of this.stagedSelection) {
              if (!stagedSet.has(p)) this.stagedSelection.delete(p);
            }
          });
        }
      )
    );

    // Set sensible initial expanded state once the first git load completes.
    this._disposeReactions.push(
      when(
        () => !this.git.isLoading && !this.git.error,
        () => {
          const hasUnstaged = this.git.unstagedFileChanges.length > 0;
          const hasStaged = this.git.stagedFileChanges.length > 0;
          const hasPullRequests = this.pr.pullRequests.length > 0;

          runInAction(() => {
            this.expandedSections = {
              unstaged: hasUnstaged || (!hasStaged && !hasUnstaged && !hasPullRequests),
              staged: hasStaged,
              pullRequests: hasPullRequests,
            };
          });
        }
      )
    );

    // Auto-collapse when a section empties; auto-expand when it gains entries from zero.
    this._disposeReactions.push(
      reaction(
        () => ({
          unstaged: this.git.unstagedFileChanges.length,
          staged: this.git.stagedFileChanges.length,
          pullRequests: this.pr.pullRequests.length,
        }),
        (curr, prev) => {
          runInAction(() => {
            const next = { ...this.expandedSections };
            let changed = false;

            if (curr.unstaged === 0 && prev.unstaged > 0) {
              next.unstaged = false;
              changed = true;
            } else if (curr.unstaged > 0 && prev.unstaged === 0) {
              if (this._suppressAutoExpand.has('unstaged')) {
                this._suppressAutoExpand.delete('unstaged');
              } else {
                next.unstaged = true;
                changed = true;
              }
            }

            if (curr.staged === 0 && prev.staged > 0) {
              next.staged = false;
              changed = true;
            } else if (curr.staged > 0 && prev.staged === 0) {
              if (this._suppressAutoExpand.has('staged')) {
                this._suppressAutoExpand.delete('staged');
              } else {
                next.staged = true;
                changed = true;
              }
            }

            if (curr.pullRequests === 0 && prev.pullRequests > 0) {
              next.pullRequests = false;
              changed = true;
            } else if (curr.pullRequests > 0 && prev.pullRequests === 0) {
              if (this._suppressAutoExpand.has('pullRequests')) {
                this._suppressAutoExpand.delete('pullRequests');
              } else {
                next.pullRequests = true;
                changed = true;
              }
            }

            if (changed) this.expandedSections = next;
          });
        }
      )
    );
  }

  get unstagedSelectionState(): SelectionState {
    const total = this.git.unstagedFileChanges.length;
    const selected = this.unstagedSelection.size;
    if (total === 0 || selected === 0) return 'none';
    if (selected === total) return 'all';
    return 'partial';
  }

  get stagedSelectionState(): SelectionState {
    const total = this.git.stagedFileChanges.length;
    const selected = this.stagedSelection.size;
    if (total === 0 || selected === 0) return 'none';
    if (selected === total) return 'all';
    return 'partial';
  }

  toggleUnstagedItem(path: string): void {
    if (this.unstagedSelection.has(path)) {
      this.unstagedSelection.delete(path);
    } else {
      this.unstagedSelection.add(path);
    }
  }

  toggleAllUnstaged(): void {
    if (this.unstagedSelectionState === 'all') {
      this.unstagedSelection.clear();
    } else {
      for (const c of this.git.unstagedFileChanges) {
        this.unstagedSelection.add(c.path);
      }
    }
  }

  clearUnstagedSelection(): void {
    this.unstagedSelection.clear();
  }

  toggleStagedItem(path: string): void {
    if (this.stagedSelection.has(path)) {
      this.stagedSelection.delete(path);
    } else {
      this.stagedSelection.add(path);
    }
  }

  toggleAllStaged(): void {
    if (this.stagedSelectionState === 'all') {
      this.stagedSelection.clear();
    } else {
      for (const c of this.git.stagedFileChanges) {
        this.stagedSelection.add(c.path);
      }
    }
  }

  clearStagedSelection(): void {
    this.stagedSelection.clear();
  }

  toggleExpanded(section: keyof ExpandedSections): void {
    runInAction(() => {
      this.expandedSections = {
        ...this.expandedSections,
        [section]: !this.expandedSections[section],
      };
    });
  }

  setExpanded(next: ExpandedSections | ((prev: ExpandedSections) => ExpandedSections)): void {
    runInAction(() => {
      this.expandedSections = typeof next === 'function' ? next(this.expandedSections) : next;
    });
  }

  expandForActiveFileType(group: 'disk' | 'staged' | 'git' | 'pr'): void {
    const section = group === 'disk' ? 'unstaged' : group === 'staged' ? 'staged' : 'pullRequests';
    if (!this.expandedSections[section]) {
      runInAction(() => {
        this.expandedSections = { ...this.expandedSections, [section]: true };
      });
    }
  }

  suppressNextAutoExpand(section: keyof ExpandedSections): void {
    this._suppressAutoExpand.add(section);
  }

  dispose(): void {
    for (const dispose of this._disposeReactions) dispose();
    this._disposeReactions = [];
  }
}

import { action, makeObservable, observable } from 'mobx';

/**
 * Per-file UI state for the stacked diff virtual list. Survives scroll-out /
 * scroll-in of a section (unlike local React state) because the virtualizer
 * unmounts off-screen rows.
 */
export class StackedDiffViewModel {
  private readonly _expanded = observable.map<string, boolean>();
  private readonly _forceLoad = observable.set<string>();

  constructor() {
    makeObservable(this, {
      toggleExpanded: action,
      setForceLoad: action,
      pruneStale: action,
    });
  }

  isExpanded(path: string): boolean {
    return this._expanded.get(path) ?? true;
  }

  toggleExpanded(path: string): void {
    this._expanded.set(path, !this.isExpanded(path));
  }

  isForceLoaded(path: string): boolean {
    return this._forceLoad.has(path);
  }

  setForceLoad(path: string): void {
    this._forceLoad.add(path);
  }

  pruneStale(currentPaths: Set<string>): void {
    for (const path of [...this._expanded.keys()]) {
      if (!currentPaths.has(path)) this._expanded.delete(path);
    }
    for (const path of [...this._forceLoad]) {
      if (!currentPaths.has(path)) this._forceLoad.delete(path);
    }
  }
}

import type { PrComment } from './prCommentsStatus';

const EMPTY: PrComment[] = [];

class SelectedPrCommentsStore {
  private selected = new Map<string, Map<string, PrComment>>();
  private listeners = new Map<string, Set<() => void>>();
  private snapshots = new Map<string, PrComment[]>();

  add(scopeKey: string, comment: PrComment): void {
    const scope = this.getOrCreateScope(scopeKey);
    scope.set(comment.id, comment);
    this.invalidateSnapshot(scopeKey);
    this.emit(scopeKey);
  }

  remove(scopeKey: string, commentId: string): void {
    const scope = this.selected.get(scopeKey);
    if (!scope?.delete(commentId)) return;
    if (scope.size === 0) this.selected.delete(scopeKey);
    this.invalidateSnapshot(scopeKey);
    this.emit(scopeKey);
  }

  toggle(scopeKey: string, comment: PrComment): void {
    const scope = this.getOrCreateScope(scopeKey);
    if (scope.has(comment.id)) {
      scope.delete(comment.id);
      if (scope.size === 0) this.selected.delete(scopeKey);
    } else {
      scope.set(comment.id, comment);
    }
    this.invalidateSnapshot(scopeKey);
    this.emit(scopeKey);
  }

  has(scopeKey: string, commentId: string): boolean {
    return this.selected.get(scopeKey)?.has(commentId) ?? false;
  }

  clear(scopeKey: string): void {
    const scope = this.selected.get(scopeKey);
    if (!scope || scope.size === 0) return;
    this.selected.delete(scopeKey);
    this.invalidateSnapshot(scopeKey);
    this.emit(scopeKey);
  }

  subscribe(scopeKey: string, listener: () => void): () => void {
    const set = this.listeners.get(scopeKey) ?? new Set();
    set.add(listener);
    this.listeners.set(scopeKey, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(scopeKey);
    };
  }

  getSnapshot(scopeKey: string): PrComment[] {
    const scope = this.selected.get(scopeKey);
    if (!scope || scope.size === 0) return EMPTY;
    let snapshot = this.snapshots.get(scopeKey);
    if (!snapshot) {
      snapshot = Array.from(scope.values());
      this.snapshots.set(scopeKey, snapshot);
    }
    return snapshot;
  }

  private getOrCreateScope(scopeKey: string): Map<string, PrComment> {
    let scope = this.selected.get(scopeKey);
    if (!scope) {
      scope = new Map();
      this.selected.set(scopeKey, scope);
    }
    return scope;
  }

  private invalidateSnapshot(scopeKey: string): void {
    this.snapshots.delete(scopeKey);
  }

  private emit(scopeKey: string): void {
    const set = this.listeners.get(scopeKey);
    if (!set) return;
    for (const fn of set) {
      try {
        fn();
      } catch (err) {
        console.error('SelectedPrCommentsStore listener error:', err);
      }
    }
  }
}

export const selectedPrCommentsStore = new SelectedPrCommentsStore();

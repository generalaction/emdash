import type { PrComment } from './prCommentsStatus';

const EMPTY: PrComment[] = [];

class SelectedPrCommentsStoreSingleton {
  private selected = new Map<string, PrComment>();
  private listeners = new Set<() => void>();
  private cachedSnapshot: PrComment[] = EMPTY;

  private updateSnapshot(): void {
    this.cachedSnapshot = this.selected.size === 0 ? EMPTY : Array.from(this.selected.values());
  }

  add(comment: PrComment): void {
    this.selected.set(comment.id, comment);
    this.updateSnapshot();
    this.notify();
  }

  remove(commentId: string): void {
    if (!this.selected.delete(commentId)) return;
    this.updateSnapshot();
    this.notify();
  }

  toggle(comment: PrComment): void {
    if (this.selected.has(comment.id)) {
      this.selected.delete(comment.id);
    } else {
      this.selected.set(comment.id, comment);
    }
    this.updateSnapshot();
    this.notify();
  }

  has(commentId: string): boolean {
    return this.selected.has(commentId);
  }

  clear(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.updateSnapshot();
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): PrComment[] {
    return this.cachedSnapshot;
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.error('SelectedPrCommentsStore listener error:', err);
      }
    }
  }
}

export const selectedPrCommentsStore = new SelectedPrCommentsStoreSingleton();

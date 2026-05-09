import { makeAutoObservable } from 'mobx';
import type { ViewId, WrapParams } from '@renderer/app/view-registry';

const MAX_STACK_SIZE = 50;

export type HistoryEntry =
  | { kind: 'view'; viewId: ViewId; params: WrapParams<ViewId> }
  | { kind: 'tab'; projectId: string; taskId: string; tabId: string };

function entriesEqual(a: HistoryEntry, b: HistoryEntry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'view' && b.kind === 'view') {
    if (a.viewId !== b.viewId) return false;
    // Task view is parameterized by taskId — different tasks are distinct entries.
    if (a.viewId === 'task') {
      const ap = a.params as { taskId?: string };
      const bp = b.params as { taskId?: string };
      return ap.taskId === bp.taskId;
    }
    return true;
  }
  if (a.kind === 'tab' && b.kind === 'tab') {
    return a.tabId === b.tabId && a.taskId === b.taskId;
  }
  return false;
}

/** Collapses adjacent identical entries that appear after a prune. */
function flatten(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((e, i) => i === 0 || !entriesEqual(e, entries[i - 1]!));
}

/**
 * Tracks a chronological back/forward navigation stack spanning both
 * view-level and tab-level navigations.
 *
 * - `push()` is a no-op while `back()`/`forward()` are applying an entry,
 *   which prevents reactive observers (e.g. TaskViewStore's tab reaction)
 *   from recording the restoration as a new entry.
 * - `prune()` removes entries for deleted entities and is a hook point for
 *   future entity-cleanup; it is not called in the initial iteration.
 */
export class NavigationHistoryStore {
  /** Append-only log; not observable — only `index` drives reactivity. */
  entries: HistoryEntry[] = [];
  index = -1;

  /** Set to true while back/forward is being applied. Suppresses push(). */
  private navigating = false;

  constructor() {
    makeAutoObservable(this, {
      entries: false,
      canGoBack: true,
      canGoForward: true,
    });
  }

  get canGoBack(): boolean {
    return this.index > 0;
  }

  get canGoForward(): boolean {
    return this.index < this.entries.length - 1;
  }

  push(entry: HistoryEntry): void {
    if (this.navigating) return;

    // Skip if identical to current entry (e.g. rapid re-activation of same tab)
    const current = this.entries[this.index];
    if (current && entriesEqual(current, entry)) return;

    // Truncate forward stack
    this.entries.splice(this.index + 1);
    this.entries.push(entry);

    // Bound to max size: drop oldest entry when over limit
    if (this.entries.length > MAX_STACK_SIZE) {
      this.entries.shift();
    } else {
      this.index++;
    }
  }

  back(apply: (entry: HistoryEntry) => void): void {
    if (!this.canGoBack) return;
    this.index--;
    this.navigating = true;
    try {
      apply(this.entries[this.index]!);
    } finally {
      this.navigating = false;
    }
  }

  forward(apply: (entry: HistoryEntry) => void): void {
    if (!this.canGoForward) return;
    this.index++;
    this.navigating = true;
    try {
      apply(this.entries[this.index]!);
    } finally {
      this.navigating = false;
    }
  }

  /**
   * Removes all entries matching the predicate, then collapses adjacent
   * identical entries so no-op back steps are not created.
   * The cursor is clamped to the surviving entry nearest the removed position.
   *
   * Hook point for future entity-cleanup (deleted conversations, closed tabs, etc.).
   */
  prune(predicate: (entry: HistoryEntry) => boolean): void {
    const currentEntry = this.entries[this.index];
    this.entries = flatten(this.entries.filter((e) => !predicate(e)));
    const newIndex = currentEntry ? this.entries.indexOf(currentEntry) : -1;
    this.index = newIndex !== -1 ? newIndex : Math.max(0, this.entries.length - 1);
  }
}

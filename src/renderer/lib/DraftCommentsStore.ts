export type DraftComment = {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
  content: string;
};

const EMPTY: DraftComment[] = [];

export function buildCommentScopeKey(taskId?: string, taskPath?: string | null): string {
  const id = (taskId || '').trim();
  if (!id) return '';
  const path = (taskPath || '').trim();
  return path ? `${id}::${path}` : id;
}

export class DraftCommentsStore {
  private comments = new Map<string, DraftComment[]>();
  private listeners = new Map<string, Set<() => void>>();

  private static MAX_COMMENTS_PER_SCOPE = 200;

  add(scopeKey: string, comment: Omit<DraftComment, 'id' | 'taskId'>): string {
    const id = crypto.randomUUID();
    const taskId = scopeKey.split('::')[0] || scopeKey;
    const draft: DraftComment = { ...comment, taskId, id };
    const existing = this.comments.get(scopeKey) ?? [];
    if (existing.length >= DraftCommentsStore.MAX_COMMENTS_PER_SCOPE) {
      console.warn(
        `DraftCommentsStore: reached ${DraftCommentsStore.MAX_COMMENTS_PER_SCOPE} comment limit for scope`
      );
      return id;
    }
    this.comments.set(scopeKey, [...existing, draft]);
    this.emit(scopeKey);
    return id;
  }

  update(scopeKey: string, commentId: string, content: string): void {
    const list = this.comments.get(scopeKey);
    if (!list || !list.some((c) => c.id === commentId)) return;
    this.comments.set(
      scopeKey,
      list.map((c) => (c.id === commentId ? { ...c, content } : c))
    );
    this.emit(scopeKey);
  }

  remove(scopeKey: string, commentId: string): void {
    const list = this.comments.get(scopeKey);
    if (!list) return;
    const next = list.filter((c) => c.id !== commentId);
    if (next.length === list.length) return;
    if (next.length === 0) {
      this.comments.delete(scopeKey);
    } else {
      this.comments.set(scopeKey, next);
    }
    this.emit(scopeKey);
  }

  consumeAll(scopeKey: string): DraftComment[] {
    const list = this.comments.get(scopeKey) ?? [];
    if (list.length > 0) {
      this.comments.delete(scopeKey);
      this.emit(scopeKey);
    }
    return list;
  }

  getAll(scopeKey: string): DraftComment[] {
    return this.comments.get(scopeKey) ?? EMPTY;
  }

  getForFile(scopeKey: string, filePath: string): DraftComment[] {
    return this.getAll(scopeKey).filter((c) => c.filePath === filePath);
  }

  getCount(scopeKey: string): number {
    return this.getAll(scopeKey).length;
  }

  // --- React integration (useSyncExternalStore) ---

  subscribe(scopeKey: string, listener: () => void): () => void {
    const set = this.listeners.get(scopeKey) ?? new Set();
    set.add(listener);
    this.listeners.set(scopeKey, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(scopeKey);
    };
  }

  getSnapshot(scopeKey: string): DraftComment[] {
    return this.getAll(scopeKey);
  }

  private emit(scopeKey: string): void {
    const set = this.listeners.get(scopeKey);
    if (!set) return;
    for (const fn of set) {
      try {
        fn();
      } catch (err) {
        console.error('DraftCommentsStore listener error:', err);
      }
    }
  }
}

export const draftCommentsStore = new DraftCommentsStore();

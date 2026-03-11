export type DraftComment = {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
  content: string;
};

const EMPTY: DraftComment[] = [];

export class DraftCommentsStore {
  private comments = new Map<string, DraftComment[]>();
  private listeners = new Map<string, Set<() => void>>();

  add(taskId: string, comment: Omit<DraftComment, 'id' | 'taskId'>): string {
    const id = crypto.randomUUID();
    const draft: DraftComment = { ...comment, taskId, id };
    const existing = this.comments.get(taskId) ?? [];
    this.comments.set(taskId, [...existing, draft]);
    this.emit(taskId);
    return id;
  }

  update(taskId: string, commentId: string, content: string): void {
    const list = this.comments.get(taskId);
    if (!list || !list.some((c) => c.id === commentId)) return;
    this.comments.set(
      taskId,
      list.map((c) => (c.id === commentId ? { ...c, content } : c))
    );
    this.emit(taskId);
  }

  remove(taskId: string, commentId: string): void {
    const list = this.comments.get(taskId);
    if (!list) return;
    const next = list.filter((c) => c.id !== commentId);
    if (next.length === list.length) return;
    if (next.length === 0) {
      this.comments.delete(taskId);
    } else {
      this.comments.set(taskId, next);
    }
    this.emit(taskId);
  }

  consumeAll(taskId: string): DraftComment[] {
    const list = this.comments.get(taskId) ?? [];
    if (list.length > 0) {
      this.comments.delete(taskId);
      this.emit(taskId);
    }
    return list;
  }

  getAll(taskId: string): DraftComment[] {
    return this.comments.get(taskId) ?? EMPTY;
  }

  getForFile(taskId: string, filePath: string): DraftComment[] {
    return this.getAll(taskId).filter((c) => c.filePath === filePath);
  }

  getCount(taskId: string): number {
    return this.getAll(taskId).length;
  }

  // --- React integration (useSyncExternalStore) ---

  subscribe(taskId: string, listener: () => void): () => void {
    const set = this.listeners.get(taskId) ?? new Set();
    set.add(listener);
    this.listeners.set(taskId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(taskId);
    };
  }

  getSnapshot(taskId: string): DraftComment[] {
    return this.getAll(taskId);
  }

  private emit(taskId: string): void {
    const set = this.listeners.get(taskId);
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

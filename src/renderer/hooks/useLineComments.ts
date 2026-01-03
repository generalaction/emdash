import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { LineComment } from '../types/electron-api';
import { formatCommentsForAgent } from '../lib/formatCommentsForAgent';

type TaskState = {
  comments: LineComment[];
  isLoading: boolean;
  error: string | null;
  hasLoaded: boolean;
};

type CreateCommentInput = {
  filePath: string;
  lineNumber: number;
  lineContent?: string;
  content: string;
};

const EMPTY_STATE: TaskState = {
  comments: [],
  isLoading: false,
  error: null,
  hasLoaded: false,
};

class LineCommentsStore {
  private states = new Map<string, TaskState>();
  private listeners = new Map<string, Set<() => void>>();
  private inFlight = new Map<string, Promise<void>>();

  private ensureState(taskId: string): TaskState {
    if (!taskId) return EMPTY_STATE;
    const existing = this.states.get(taskId);
    if (existing) return existing;
    const next = { ...EMPTY_STATE };
    this.states.set(taskId, next);
    return next;
  }

  getSnapshot(taskId: string): TaskState {
    return this.ensureState(taskId);
  }

  subscribe(taskId: string, listener: () => void): () => void {
    if (!taskId) return () => {};
    const set = this.listeners.get(taskId) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(taskId, set);
    return () => {
      const current = this.listeners.get(taskId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(taskId);
    };
  }

  private emit(taskId: string) {
    const set = this.listeners.get(taskId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener();
      } catch {}
    }
  }

  private setState(taskId: string, updater: (prev: TaskState) => TaskState) {
    const prev = this.ensureState(taskId);
    const next = updater(prev);
    this.states.set(taskId, next);
    this.emit(taskId);
  }

  refresh(taskId: string): Promise<void> {
    if (!taskId) return Promise.resolve();
    const inflight = this.inFlight.get(taskId);
    if (inflight) return inflight;

    const request = (async () => {
      this.setState(taskId, (prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const result = await window.electronAPI.lineCommentsGet({ taskId });
        if (result.success && result.comments) {
          const nextComments = result.comments ?? [];
          this.setState(taskId, (prev) => ({
            ...prev,
            comments: nextComments,
            isLoading: false,
            error: null,
            hasLoaded: true,
          }));
        } else {
          this.setState(taskId, (prev) => ({
            ...prev,
            isLoading: false,
            error: result.error ?? 'Failed to load comments',
            hasLoaded: true,
          }));
        }
      } catch (err) {
        this.setState(taskId, (prev) => ({
          ...prev,
          isLoading: false,
          error: (err as Error).message,
          hasLoaded: true,
        }));
      }
    })();

    this.inFlight.set(taskId, request);
    request.finally(() => {
      this.inFlight.delete(taskId);
    });
    return request;
  }

  async createComment(taskId: string, input: CreateCommentInput): Promise<string | null> {
    if (!taskId) return null;
    const result = await window.electronAPI.lineCommentsCreate({
      taskId,
      filePath: input.filePath,
      lineNumber: input.lineNumber,
      lineContent: input.lineContent,
      content: input.content,
    });

    if (result.success) {
      await this.refresh(taskId);
      return result.id ?? null;
    }
    return null;
  }

  async updateComment(taskId: string, id: string, content: string): Promise<boolean> {
    if (!taskId) return false;
    const result = await window.electronAPI.lineCommentsUpdate({ id, content });
    if (result.success) {
      await this.refresh(taskId);
      return true;
    }
    return false;
  }

  async deleteComment(taskId: string, id: string): Promise<boolean> {
    if (!taskId) return false;
    const result = await window.electronAPI.lineCommentsDelete(id);
    if (result.success) {
      await this.refresh(taskId);
      return true;
    }
    return false;
  }

  async markSent(taskId: string, commentIds: string[]): Promise<boolean> {
    if (!taskId || commentIds.length === 0) return false;
    const result = await window.electronAPI.lineCommentsMarkSent(commentIds);
    if (result.success) {
      await this.refresh(taskId);
      return true;
    }
    return false;
  }
}

const store = new LineCommentsStore();

export function useTaskComments(taskId?: string) {
  const resolvedTaskId = taskId ?? '';
  const state = useSyncExternalStore(
    useCallback((listener) => store.subscribe(resolvedTaskId, listener), [resolvedTaskId]),
    useCallback(() => store.getSnapshot(resolvedTaskId), [resolvedTaskId]),
    useCallback(() => store.getSnapshot(resolvedTaskId), [resolvedTaskId])
  );

  useEffect(() => {
    if (!taskId) return;
    void store.refresh(taskId);
  }, [taskId]);

  const comments = state.comments;
  const unsentComments = useMemo(() => comments.filter((comment) => !comment.sentAt), [comments]);

  const countsByFile = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const comment of unsentComments) {
      counts[comment.filePath] = (counts[comment.filePath] || 0) + 1;
    }
    return counts;
  }, [unsentComments]);

  const formatted = useMemo(
    () => formatCommentsForAgent(comments, { includeIntro: false }),
    [comments]
  );
  const formattedUnsent = useMemo(
    () => formatCommentsForAgent(unsentComments, { includeIntro: false }),
    [unsentComments]
  );

  const refresh = useCallback(() => store.refresh(resolvedTaskId), [resolvedTaskId]);

  const createComment = useCallback(
    (input: CreateCommentInput) => store.createComment(resolvedTaskId, input),
    [resolvedTaskId]
  );

  const updateComment = useCallback(
    (id: string, content: string) => store.updateComment(resolvedTaskId, id, content),
    [resolvedTaskId]
  );

  const deleteComment = useCallback(
    (id: string) => store.deleteComment(resolvedTaskId, id),
    [resolvedTaskId]
  );

  const markSent = useCallback(
    (commentIds: string[]) => store.markSent(resolvedTaskId, commentIds),
    [resolvedTaskId]
  );

  return {
    comments,
    unsentComments,
    unsentCount: unsentComments.length,
    countsByFile,
    formatted,
    formattedUnsent,
    isLoading: state.isLoading,
    error: state.error,
    hasLoaded: state.hasLoaded,
    refresh,
    createComment,
    updateComment,
    deleteComment,
    markSent,
  };
}

export function useLineComments(
  taskId: string,
  filePath?: string,
  opts?: { includeSent?: boolean }
) {
  const includeSent = opts?.includeSent ?? true;
  const taskComments = useTaskComments(taskId);
  const { createComment, updateComment, deleteComment, refresh, isLoading, error } = taskComments;

  const comments = useMemo(() => {
    if (!filePath) return [] as LineComment[];
    return taskComments.comments.filter((comment) => {
      if (comment.filePath !== filePath) return false;
      if (!includeSent && comment.sentAt) return false;
      return true;
    });
  }, [filePath, includeSent, taskComments.comments]);

  const addComment = useCallback(
    (lineNumber: number, content: string, lineContent?: string) => {
      if (!filePath) return Promise.resolve(null);
      return createComment({
        filePath,
        lineNumber,
        lineContent,
        content,
      });
    },
    [createComment, filePath]
  );

  return {
    comments,
    isLoading,
    error,
    addComment,
    updateComment,
    deleteComment,
    refreshComments: refresh,
  };
}

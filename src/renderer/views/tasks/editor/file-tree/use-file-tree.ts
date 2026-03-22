import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import type { FileNode, FileWatchEvent } from '@shared/fs';
import { events, rpc } from '@renderer/core/ipc';
import { useTaskViewState } from '@renderer/core/tasks/task-view-state-provider';
import { buildVisibleRows, isExcluded, makeNode, sortedChildPaths } from './utils';

export function useFileTree(projectId: string, taskId: string, isReady: boolean) {
  const { getTaskViewState, setTaskViewState } = useTaskViewState();

  // Mutable refs for the flat state — updated imperatively to avoid excessive
  // re-renders during rapid mutations (watch events, speculative prefetch).
  const nodesRef = useRef<Map<string, FileNode>>(new Map());
  const childIndexRef = useRef<Map<string | null, string[]>>(new Map());
  const loadedPathsRef = useRef<Set<string>>(new Set());
  const pendingPathsRef = useRef<Set<string>>(new Set());

  // React state that drives re-renders — incremented on each substantive mutation.
  const [generation, setGeneration] = useState(0);
  const bump = useCallback(() => setGeneration((g) => g + 1), []);

  // Debounced bump for speculative subdirectory loads — collapses bursts of
  // prefetch completions into a single re-render.
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpDebounced = useCallback(() => {
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
    bumpTimerRef.current = setTimeout(bump, 50);
  }, [bump]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(getTaskViewState(taskId).editorView.expandedPaths)
  );

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expose a stable snapshot of loadedPaths for the watchSetPaths effect.
  const [loadedPathsSnapshot, setLoadedPathsSnapshot] = useState<Set<string>>(new Set());

  // Debounced watch-sync — collapses rapid loadedPathsSnapshot updates (one per
  // speculative prefetch dir) into a single watchSetPaths IPC call.
  const watchSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleWatchSync = useCallback(() => {
    if (watchSyncTimerRef.current) clearTimeout(watchSyncTimerRef.current);
    watchSyncTimerRef.current = setTimeout(() => {
      setLoadedPathsSnapshot(new Set(loadedPathsRef.current));
    }, 200);
  }, []);

  const addNode = useCallback((node: FileNode) => {
    nodesRef.current.set(node.path, node);
    const parent = node.parentPath;
    const existing = childIndexRef.current.get(parent) ?? [];
    if (!existing.includes(node.path)) {
      childIndexRef.current.set(
        parent,
        sortedChildPaths([...existing, node.path], nodesRef.current)
      );
    }
  }, []);

  const removeNode = useCallback((path: string) => {
    const node = nodesRef.current.get(path);
    if (!node) return;

    // Remove from childIndex
    const siblings = childIndexRef.current.get(node.parentPath) ?? [];
    childIndexRef.current.set(
      node.parentPath,
      siblings.filter((p) => p !== path)
    );

    // Remove node and all descendants
    const toRemove: string[] = [path];
    while (toRemove.length) {
      const p = toRemove.pop()!;
      nodesRef.current.delete(p);
      loadedPathsRef.current.delete(p);
      const children = childIndexRef.current.get(p) ?? [];
      toRemove.push(...children);
      childIndexRef.current.delete(p);
    }
  }, []);

  const applyEntries = useCallback(
    (dirPath: string, entries: Array<{ path: string; type: 'file' | 'dir'; mtime?: Date }>) => {
      const affectedParents = new Set<string | null>();

      for (const entry of entries) {
        const fullPath = entry.path;
        if (isExcluded(fullPath)) continue;
        const node = makeNode(fullPath, entry.type === 'dir' ? 'directory' : 'file', entry.mtime);

        nodesRef.current.set(node.path, node);

        const parent = node.parentPath;
        const siblings = childIndexRef.current.get(parent) ?? [];
        if (!siblings.includes(node.path)) {
          siblings.push(node.path);
          childIndexRef.current.set(parent, siblings);
        }
        affectedParents.add(parent);
      }

      // Sort each affected parent's children once after all nodes are inserted.
      for (const parent of affectedParents) {
        const children = childIndexRef.current.get(parent);
        if (children) {
          childIndexRef.current.set(parent, sortedChildPaths(children, nodesRef.current));
        }
      }

      loadedPathsRef.current.add(dirPath);
      scheduleWatchSync();
    },
    [scheduleWatchSync]
  );

  const loadDir = useCallback(
    async (dirPath: string): Promise<void> => {
      if (loadedPathsRef.current.has(dirPath) || pendingPathsRef.current.has(dirPath)) return;
      pendingPathsRef.current.add(dirPath);

      try {
        const result = await rpc.fs.listFiles(projectId, taskId, dirPath || '.', {
          recursive: false,
          includeHidden: true,
        });

        if (!result.success) {
          if (dirPath === '') setError('Failed to load files');
          return;
        }

        applyEntries(dirPath, result.data.entries);

        // Clear any error left over from a previous failed attempt on this root dir.
        if (dirPath === '') setError(null);

        // Root dir triggers an immediate render; subdirs use a debounced bump
        // to coalesce the burst of speculative prefetch completions.
        if (dirPath === '') {
          bump();
        } else {
          bumpDebounced();
        }

        // Speculative prefetch: fire loadDir for every directory child (depth+1).
        for (const entry of result.data.entries) {
          if (entry.type === 'dir' && !isExcluded(entry.path)) {
            void loadDir(entry.path);
          }
        }
      } catch (e) {
        if (dirPath === '') setError(e instanceof Error ? e.message : 'Failed to load files');
      } finally {
        pendingPathsRef.current.delete(dirPath);
        if (dirPath === '') setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, taskId, applyEntries, bump, bumpDebounced]
  );

  useEffect(() => {
    nodesRef.current = new Map();
    childIndexRef.current = new Map();
    loadedPathsRef.current = new Set();
    pendingPathsRef.current = new Set();

    if (bumpTimerRef.current) {
      clearTimeout(bumpTimerRef.current);
      bumpTimerRef.current = null;
    }
    if (watchSyncTimerRef.current) {
      clearTimeout(watchSyncTimerRef.current);
      watchSyncTimerRef.current = null;
    }

    setLoadedPathsSnapshot(new Set());
    setIsLoading(true);
    setError(null);

    setExpandedPaths(new Set(getTaskViewState(taskId).editorView.expandedPaths));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  useEffect(() => {
    if (!projectId || !taskId || !isReady) return;
    loadDir('');
  }, [projectId, taskId, isReady, loadDir]);

  const toggleExpand = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          // Ensure the directory is loaded when expanded
          if (!loadedPathsRef.current.has(path)) {
            void loadDir(path);
          }
        }
        setTaskViewState(taskId, {
          editorView: { ...getTaskViewState(taskId).editorView, expandedPaths: [...next] },
        });
        return next;
      });
    },
    [taskId, loadDir, getTaskViewState, setTaskViewState]
  );

  const revealFile = useCallback(
    async (filePath: string) => {
      const parts = filePath.split('/').filter(Boolean);
      const dirs: string[] = [];
      for (let i = 1; i < parts.length; i++) {
        dirs.push(parts.slice(0, i).join('/'));
      }

      for (const dir of dirs) {
        await loadDir(dir);
      }

      setExpandedPaths((prev) => {
        const next = new Set(prev);
        for (const dir of dirs) next.add(dir);
        setTaskViewState(taskId, {
          editorView: { ...getTaskViewState(taskId).editorView, expandedPaths: [...next] },
        });
        return next;
      });

      bump();
    },
    [taskId, loadDir, bump, getTaskViewState, setTaskViewState]
  );

  const applyWatchEvents = useCallback(
    (watchEvents: FileWatchEvent[]) => {
      let changed = false;

      for (const evt of watchEvents) {
        if (isExcluded(evt.path)) continue;

        if (evt.type === 'create') {
          // Only add if the parent directory has already been loaded
          const node = makeNode(evt.path, evt.entryType);
          const parentLoaded = loadedPathsRef.current.has(node.parentPath ?? '');
          if (parentLoaded && !nodesRef.current.has(evt.path)) {
            addNode(node);
            changed = true;
          }
        } else if (evt.type === 'delete') {
          if (nodesRef.current.has(evt.path)) {
            removeNode(evt.path);
            changed = true;
          }
        } else if (evt.type === 'modify') {
          const existing = nodesRef.current.get(evt.path);
          if (existing) {
            nodesRef.current.set(evt.path, { ...existing, mtime: new Date() });
            changed = true;
          }
        } else if (evt.type === 'rename' && evt.oldPath) {
          if (nodesRef.current.has(evt.oldPath)) {
            removeNode(evt.oldPath);
            changed = true;
          }
          const node = makeNode(evt.path, evt.entryType);
          const parentLoaded = loadedPathsRef.current.has(node.parentPath ?? '');
          if (parentLoaded) {
            addNode(node);
            changed = true;
          }
        }
      }

      if (changed) bump();
    },
    [addNode, removeNode, bump]
  );

  useEffect(() => {
    if (!taskId) return;
    return events.on(fsWatchEventChannel, (data) => applyWatchEvents(data.events), taskId);
  }, [taskId, applyWatchEvents]);

  useEffect(() => {
    if (!projectId || !taskId) return;
    rpc.fs
      .watchSetPaths(projectId, taskId, ['', ...loadedPathsSnapshot], 'filetree')
      .catch(() => {});
  }, [projectId, taskId, loadedPathsSnapshot]);

  useEffect(() => {
    return () => {
      rpc.fs.watchStop(projectId, taskId, 'filetree').catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  const visibleRows = useMemo(
    () => buildVisibleRows(nodesRef.current, childIndexRef.current, expandedPaths),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generation, expandedPaths]
  );

  return {
    visibleRows,
    expandedPaths,
    loadedPaths: loadedPathsRef.current,
    toggleExpand,
    revealFile,
    isLoading,
    error,
  };
}

export type UseFileTreeResult = ReturnType<typeof useFileTree>;

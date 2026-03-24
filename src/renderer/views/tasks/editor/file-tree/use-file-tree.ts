import { runInAction } from 'mobx';
import { useLocalObservable } from 'mobx-react-lite';
import { useCallback, useEffect, useRef } from 'react';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import type { FileNode, FileWatchEvent } from '@shared/fs';
import { events, rpc } from '@renderer/core/ipc';
import { taskViewStateStore } from '@renderer/core/tasks/task-view-store';
import { buildVisibleRows, isExcluded, makeNode, sortedChildPaths } from './utils';

export function useFileTree(projectId: string, taskId: string, isReady: boolean) {
  // Mutable refs for the flat state — updated imperatively to avoid excessive
  // re-renders during rapid mutations (watch events, speculative prefetch).
  const nodesRef = useRef<Map<string, FileNode>>(new Map());
  const childIndexRef = useRef<Map<string | null, string[]>>(new Map());
  const loadedPathsRef = useRef<Set<string>>(new Set());
  const pendingPathsRef = useRef<Set<string>>(new Set());

  // Ref to the current task's EditorViewState — updated on taskId change.
  const editorViewRef = useRef(taskViewStateStore.getOrCreate(taskId).editorView);

  const local = useLocalObservable(() => ({
    generation: 0,
    isLoading: true,
    error: null as string | null,
    bump() {
      this.generation++;
    },
    setLoading(v: boolean) {
      this.isLoading = v;
    },
    setError(e: string | null) {
      this.error = e;
    },
    get visibleRows(): FileNode[] {
      // Declare a dependency on generation so bumping forces recompute
      // even though nodesRef/childIndexRef are not observable.
      void this.generation;
      // ObservableSet accesses inside buildVisibleRows are tracked by MobX —
      // toggling or adding a path automatically re-runs this computed.
      return buildVisibleRows(
        nodesRef.current,
        childIndexRef.current,
        editorViewRef.current.expandedPaths
      );
    },
  }));

  // Debounced bump for speculative subdirectory loads.
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpDebounced = useCallback(() => {
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
    bumpTimerRef.current = setTimeout(() => local.bump(), 50);
  }, [local]);

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

    const siblings = childIndexRef.current.get(node.parentPath) ?? [];
    childIndexRef.current.set(
      node.parentPath,
      siblings.filter((p) => p !== path)
    );

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

      for (const parent of affectedParents) {
        const children = childIndexRef.current.get(parent);
        if (children) {
          childIndexRef.current.set(parent, sortedChildPaths(children, nodesRef.current));
        }
      }

      loadedPathsRef.current.add(dirPath);
    },
    []
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
          if (dirPath === '') local.setError('Failed to load files');
          return;
        }

        applyEntries(dirPath, result.data.entries);

        if (dirPath === '') {
          local.setError(null);
        }

        if (dirPath === '') {
          local.bump();
        } else {
          bumpDebounced();
        }

        for (const entry of result.data.entries) {
          if (entry.type === 'dir' && !isExcluded(entry.path)) {
            void loadDir(entry.path);
          }
        }
      } catch (e) {
        if (dirPath === '') local.setError(e instanceof Error ? e.message : 'Failed to load files');
      } finally {
        pendingPathsRef.current.delete(dirPath);
        if (dirPath === '') local.setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, taskId, applyEntries, local, bumpDebounced]
  );

  // Reset state when projectId/taskId changes.
  useEffect(() => {
    editorViewRef.current = taskViewStateStore.getOrCreate(taskId).editorView;

    nodesRef.current = new Map();
    childIndexRef.current = new Map();
    loadedPathsRef.current = new Set();
    pendingPathsRef.current = new Set();

    if (bumpTimerRef.current) {
      clearTimeout(bumpTimerRef.current);
      bumpTimerRef.current = null;
    }

    local.setLoading(true);
    local.setError(null);
    // Bump so visibleRows picks up the new editorViewRef and clears stale rows.
    local.bump();
  }, [projectId, taskId, local]);

  useEffect(() => {
    if (!projectId || !taskId || !isReady) return;
    loadDir('');
  }, [projectId, taskId, isReady, loadDir]);

  const toggleExpand = useCallback(
    (path: string) => {
      const { expandedPaths } = editorViewRef.current;
      if (expandedPaths.has(path)) {
        expandedPaths.delete(path);
        // MobX invalidates visibleRows computed automatically via ObservableSet tracking.
      } else {
        expandedPaths.add(path);
        if (!loadedPathsRef.current.has(path)) {
          void loadDir(path);
        }
      }
    },
    [loadDir]
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

      runInAction(() => {
        for (const dir of dirs) editorViewRef.current.expandedPaths.add(dir);
      });
      // Bump for the newly loaded directory nodes.
      local.bump();
    },
    [loadDir, local]
  );

  const applyWatchEvents = useCallback(
    (watchEvents: FileWatchEvent[]) => {
      let changed = false;

      for (const evt of watchEvents) {
        if (isExcluded(evt.path)) continue;

        if (evt.type === 'create') {
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

      if (changed) local.bump();
    },
    [addNode, removeNode, local]
  );

  useEffect(() => {
    if (!taskId) return;
    return events.on(fsWatchEventChannel, (data) => applyWatchEvents(data.events), taskId);
  }, [taskId, applyWatchEvents]);

  useEffect(() => {
    if (!projectId || !taskId) return;
    rpc.fs.watchSetPaths(projectId, taskId, [''], 'filetree').catch(() => {});
    return () => {
      rpc.fs.watchStop(projectId, taskId, 'filetree').catch(() => {});
    };
  }, [projectId, taskId]);

  return {
    visibleRows: local.visibleRows,
    expandedPaths: editorViewRef.current.expandedPaths,
    loadedPaths: loadedPathsRef.current,
    toggleExpand,
    revealFile,
    isLoading: local.isLoading,
    error: local.error,
  };
}

export type UseFileTreeResult = ReturnType<typeof useFileTree>;

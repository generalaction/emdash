import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import type { FileNode, FileWatchEvent } from '@shared/fs';
import { events, rpc } from '@renderer/core/ipc';
import { getEditorState, saveEditorState } from '@renderer/lib/editorStateStorage';

// ---------------------------------------------------------------------------
// Excluded directory/file names — kept in sync with DEFAULT_TREE_EXCLUDE in
// editor-file-tree.tsx so the flat tree and renderer agree on visibility.
// ---------------------------------------------------------------------------

const EXCLUDED_NAMES = new Set([
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '.turbo',
  'coverage',
  '.nyc_output',
  '.cache',
  'tmp',
  'temp',
  '.DS_Store',
  'Thumbs.db',
  '.vscode-test',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.terraform',
  '.serverless',
  '.checkouts',
  'checkouts',
  '.conductor',
  '.cursor',
  '.claude',
  '.amp',
  '.codex',
  '.aider',
  '.continue',
  '.cody',
  '.windsurf',
  'worktrees',
  '.worktrees',
  '.emdash',
  'node_modules',
]);

function isExcluded(path: string): boolean {
  return path.split('/').some((seg) => EXCLUDED_NAMES.has(seg));
}

// ---------------------------------------------------------------------------
// Helpers for building FileNode from a raw entry path
// ---------------------------------------------------------------------------

function makeNode(relPath: string, type: 'file' | 'directory', mtime?: Date): FileNode {
  const parts = relPath.split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? relPath;
  const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
  const depth = parts.length - 1;
  const extension = type === 'file' && name.includes('.') ? name.split('.').pop() : undefined;

  return {
    path: relPath,
    name,
    parentPath,
    depth,
    type,
    isHidden: name.startsWith('.'),
    extension,
    mtime,
  };
}

// ---------------------------------------------------------------------------
// Sorted insertion into childIndex
// Directories come before files; within each group, alphabetical order.
// ---------------------------------------------------------------------------

function insertSorted(
  childPaths: string[],
  newPath: string,
  nodes: Map<string, FileNode>
): string[] {
  const newNode = nodes.get(newPath);
  if (!newNode) return [...childPaths, newPath];

  const result = [...childPaths, newPath];
  result.sort((a, b) => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb) return 0;
    if (na.type !== nb.type) return na.type === 'directory' ? -1 : 1;
    return na.name.localeCompare(nb.name);
  });
  return result;
}

function sortedChildPaths(paths: string[], nodes: Map<string, FileNode>): string[] {
  return [...paths].sort((a, b) => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb) return 0;
    if (na.type !== nb.type) return na.type === 'directory' ? -1 : 1;
    return na.name.localeCompare(nb.name);
  });
}

// ---------------------------------------------------------------------------
// Visible rows derivation
// ---------------------------------------------------------------------------

export function buildVisibleRows(
  nodes: Map<string, FileNode>,
  childIndex: Map<string | null, string[]>,
  expandedPaths: Set<string>
): FileNode[] {
  const rows: FileNode[] = [];

  function walk(parent: string | null) {
    for (const path of childIndex.get(parent) ?? []) {
      const node = nodes.get(path);
      if (!node) continue;
      rows.push(node);
      if (node.type === 'directory' && expandedPaths.has(path)) {
        walk(path);
      }
    }
  }

  walk(null);
  return rows;
}

// ---------------------------------------------------------------------------
// Hook public interface
// ---------------------------------------------------------------------------

export interface UseFileTreeResult {
  visibleRows: FileNode[];
  expandedPaths: Set<string>;
  loadedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  revealFile: (filePath: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// useFileTree
// ---------------------------------------------------------------------------

export function useFileTree(projectId: string, taskId: string): UseFileTreeResult {
  // Mutable refs for the flat state — updated imperatively to avoid excessive
  // re-renders during rapid mutations (watch events, speculative prefetch).
  const nodesRef = useRef<Map<string, FileNode>>(new Map());
  const childIndexRef = useRef<Map<string | null, string[]>>(new Map());
  const loadedPathsRef = useRef<Set<string>>(new Set());
  const pendingPathsRef = useRef<Set<string>>(new Set());

  // React state that drives re-renders — incremented on each substantive mutation.
  const [generation, setGeneration] = useState(0);
  const bump = useCallback(() => setGeneration((g) => g + 1), []);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const state = getEditorState(taskId);
    return new Set(state?.expandedPaths ?? []);
  });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expose a stable snapshot of loadedPaths for the watchSetPaths effect.
  const [loadedPathsSnapshot, setLoadedPathsSnapshot] = useState<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Helpers: add a node into the flat state
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // applyEntries: process raw listing results into the flat state
  // ---------------------------------------------------------------------------

  const applyEntries = useCallback(
    (dirPath: string, entries: Array<{ path: string; type: 'file' | 'dir'; mtime?: Date }>) => {
      for (const entry of entries) {
        // entry.path from listFiles is always relative to the project root,
        // not relative to dirPath — so use it directly without any prefix.
        const fullPath = entry.path;
        if (isExcluded(fullPath)) continue;
        const node = makeNode(fullPath, entry.type === 'dir' ? 'directory' : 'file', entry.mtime);
        addNode(node);
      }

      loadedPathsRef.current.add(dirPath);
      setLoadedPathsSnapshot(new Set(loadedPathsRef.current));
    },
    [addNode]
  );

  // ---------------------------------------------------------------------------
  // loadDir: fetch one directory level lazily
  // ---------------------------------------------------------------------------

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
        bump();

        // Speculative prefetch: fire loadDir for every directory child (depth+1).
        // entry.path is always project-root-relative, so use it directly.
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
    [projectId, taskId, applyEntries, bump]
  );

  // ---------------------------------------------------------------------------
  // Initial load when projectId/taskId changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!projectId || !taskId) return;

    // Reset state
    nodesRef.current = new Map();
    childIndexRef.current = new Map();
    loadedPathsRef.current = new Set();
    pendingPathsRef.current = new Set();
    setLoadedPathsSnapshot(new Set());
    setIsLoading(true);
    setError(null);

    // Restore expanded paths for this task
    const state = getEditorState(taskId);
    setExpandedPaths(new Set(state?.expandedPaths ?? []));

    void loadDir('');
  }, [projectId, taskId, loadDir]);

  // ---------------------------------------------------------------------------
  // toggleExpand
  // ---------------------------------------------------------------------------

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
        saveEditorState(taskId, { expandedPaths: [...next] });
        return next;
      });
    },
    [taskId, loadDir]
  );

  // ---------------------------------------------------------------------------
  // revealFile: load ancestor dirs and expand them so the file is visible
  // ---------------------------------------------------------------------------

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
        saveEditorState(taskId, { expandedPaths: [...next] });
        return next;
      });

      bump();
    },
    [taskId, loadDir, bump]
  );

  // ---------------------------------------------------------------------------
  // applyWatchEvents: apply create/delete/modify/rename to flat state
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Watch event subscription
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!taskId) return;
    return events.on(fsWatchEventChannel, (data) => applyWatchEvents(data.events), taskId);
  }, [taskId, applyWatchEvents]);

  // ---------------------------------------------------------------------------
  // Sync watched paths with main process whenever loadedPaths changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!projectId || !taskId) return;
    rpc.fs.watchSetPaths(projectId, taskId, ['', ...loadedPathsSnapshot]).catch(() => {});
  }, [projectId, taskId, loadedPathsSnapshot]);

  // ---------------------------------------------------------------------------
  // Stop watcher on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      rpc.fs.watchStop(projectId, taskId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  // ---------------------------------------------------------------------------
  // Derive visible rows
  // ---------------------------------------------------------------------------

  // generation is included in deps so visibleRows updates when nodes change
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

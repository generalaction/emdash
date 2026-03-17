import { ChevronDown, ChevronRight } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon } from '@renderer/components/FileExplorer/FileIcons';
import { rpc } from '@renderer/core/ipc';
import { getEditorState, saveEditorState } from '@renderer/lib/editorStateStorage';
import { cn } from '@renderer/lib/utils';
import { useEditorContext } from './editor-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  isHidden?: boolean;
  extension?: string;
  isLoaded?: boolean;
}

interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

// ---------------------------------------------------------------------------
// Tree node sub-component (purely presentational)
// ---------------------------------------------------------------------------

const TreeNode: React.FC<{
  node: FileNode;
  level: number;
  selectedPath?: string | null;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
  onOpen?: (path: string) => void;
  onLoadChildren: (node: FileNode) => Promise<void>;
  fileChanges: FileChange[];
}> = ({
  node,
  level,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onSelect,
  onOpen,
  onLoadChildren,
  fileChanges,
}) => {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const fileStatus = fileChanges.find((c) => c.path === node.path)?.status;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'directory') {
      if (!isExpanded && !node.isLoaded) {
        await onLoadChildren(node);
      }
      onToggleExpand(node.path);
    } else {
      onSelect(node.path);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'file' && onOpen) {
      onOpen(node.path);
    }
  };

  return (
    <div>
      <div
        className={cn(
          'flex h-6 cursor-pointer select-none items-center px-1 hover:bg-accent/50',
          isSelected && 'bg-accent',
          node.isHidden && 'opacity-60'
        )}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={node.type === 'directory' ? isExpanded : undefined}
      >
        {node.type === 'directory' && (
          <span className="mr-1 text-muted-foreground">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        )}
        {node.type === 'file' && (
          <span className="mr-1.5">
            <FileIcon filename={node.name} isDirectory={false} isExpanded={false} />
          </span>
        )}
        <span
          className={cn(
            'flex-1 truncate text-sm',
            fileStatus === 'added' && 'text-green-500',
            fileStatus === 'modified' && 'text-amber-500',
            fileStatus === 'deleted' && 'text-red-500 line-through',
            fileStatus === 'renamed' && 'text-blue-500'
          )}
        >
          {node.name}
        </span>
      </div>

      {node.type === 'directory' && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onOpen={onOpen}
              onLoadChildren={onLoadChildren}
              fileChanges={fileChanges}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Default patterns to exclude from the tree
// ---------------------------------------------------------------------------

const DEFAULT_TREE_EXCLUDE = [
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
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children?.length) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

interface RawEntry {
  path: string;
  type: 'file' | 'dir';
}

// ---------------------------------------------------------------------------
// Main TaskFileTree component
// ---------------------------------------------------------------------------

export function EditorFileTree() {
  const { projectId, taskId, activeFilePath, loadFile, fileChanges } = useEditorContext();

  const [tree, setTree] = useState<FileNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const state = getEditorState(taskId);
    return new Set(state?.expandedPaths ?? []);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState<RawEntry[]>([]);
  const loadingPathsRef = useRef(new Set<string>());

  const allExcludePatterns = useMemo(() => DEFAULT_TREE_EXCLUDE, []);

  const shouldExclude = useCallback(
    (path: string): boolean => {
      const parts = path.split('/');
      return parts.some((part) => {
        const lowerPart = part.toLowerCase();
        return allExcludePatterns.some((pattern) => {
          const lowerPattern = pattern.toLowerCase();
          if (lowerPattern.includes('*')) {
            const regexStr = '^' + lowerPattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
            return (
              new RegExp(regexStr).test(lowerPart) || new RegExp(regexStr).test(path.toLowerCase())
            );
          }
          return lowerPart === lowerPattern;
        });
      });
    },
    [allExcludePatterns]
  );

  const buildNodesFromPath = useCallback(
    (dirPath: string, files: RawEntry[]): FileNode[] => {
      const immediateChildren = new Map<string, { type: 'file' | 'dir' }>();

      files.forEach((item) => {
        if (shouldExclude(item.path)) return;

        if (dirPath) {
          if (!item.path.startsWith(dirPath + '/')) return;
          const relativePath = item.path.substring(dirPath.length + 1);
          const firstSlash = relativePath.indexOf('/');
          if (firstSlash === -1) {
            immediateChildren.set(relativePath, { type: item.type });
          } else {
            const dirName = relativePath.substring(0, firstSlash);
            if (!immediateChildren.has(dirName)) {
              immediateChildren.set(dirName, { type: 'dir' });
            }
          }
        } else {
          const firstSlash = item.path.indexOf('/');
          if (firstSlash === -1) {
            immediateChildren.set(item.path, { type: item.type });
          } else {
            const dirName = item.path.substring(0, firstSlash);
            if (!immediateChildren.has(dirName)) {
              immediateChildren.set(dirName, { type: 'dir' });
            }
          }
        }
      });

      const nodes: FileNode[] = [];
      immediateChildren.forEach((info, name) => {
        const nodePath = dirPath ? `${dirPath}/${name}` : name;
        nodes.push({
          id: nodePath,
          name,
          path: nodePath,
          type: info.type === 'dir' ? 'directory' : 'file',
          children: info.type === 'dir' ? [] : undefined,
          isHidden: name.startsWith('.'),
          extension: info.type !== 'dir' && name.includes('.') ? name.split('.').pop() : undefined,
          isLoaded: false,
        });
      });

      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return nodes;
    },
    [shouldExclude]
  );

  // Initial load of root directory entries
  useEffect(() => {
    if (!projectId || !taskId) return;

    const loadRoot = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await rpc.fs.listFiles(projectId, taskId, '.', {
          recursive: false,
          includeHidden: true,
        });
        if (!result.success) {
          setError('Failed to load files');
          return;
        }
        const entries: RawEntry[] = result.data.entries.map((e) => ({
          path: e.path,
          type: e.type,
        }));
        setAllFiles(entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load files');
      } finally {
        setLoading(false);
      }
    };

    void loadRoot();
  }, [projectId, taskId]);

  // Rebuild tree whenever allFiles or filter changes
  useEffect(() => {
    if (allFiles.length === 0) return;
    const rootNodes = buildNodesFromPath('', allFiles);
    setTree((prevTree) => {
      if (prevTree.length === 0) return rootNodes;
      const preserveLoaded = (newNodes: FileNode[], oldNodes: FileNode[]): FileNode[] =>
        newNodes.map((newNode) => {
          const oldNode = oldNodes.find((n) => n.path === newNode.path);
          if (oldNode?.isLoaded && oldNode.children) {
            return {
              ...newNode,
              isLoaded: true,
              children: preserveLoaded(
                buildNodesFromPath(newNode.path, allFiles),
                oldNode.children
              ),
            };
          }
          return newNode;
        });
      return preserveLoaded(rootNodes, prevTree);
    });
  }, [allFiles, buildNodesFromPath]);

  // Lazy-load expanded directories that haven't been loaded yet
  useEffect(() => {
    if (expandedPaths.size === 0 || tree.length === 0) return;
    const paths = [...expandedPaths].sort(
      (a, b) => a.split('/').filter(Boolean).length - b.split('/').filter(Boolean).length
    );
    const path = paths.find((p) => {
      if (loadingPathsRef.current.has(p)) return false;
      const node = findNode(tree, p);
      return node?.type === 'directory' && !node.isLoaded;
    });
    if (!path) return;
    const node = findNode(tree, path);
    if (!node) return;
    loadingPathsRef.current.add(path);
    void loadChildren(node).finally(() => {
      loadingPathsRef.current.delete(path);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedPaths, tree]);

  // Restore expanded paths when taskId changes
  useEffect(() => {
    const state = getEditorState(taskId);
    setExpandedPaths(new Set(state?.expandedPaths ?? []));
  }, [taskId]);

  const loadChildren = useCallback(
    async (node: FileNode) => {
      if (node.isLoaded) return;
      try {
        const result = await rpc.fs.listFiles(projectId, taskId, node.path, {
          recursive: false,
          includeHidden: true,
        });
        if (!result.success) return;

        const newItems: RawEntry[] = result.data.entries.map((e) => ({
          path: `${node.path}/${e.path}`,
          type: e.type,
        }));

        setAllFiles((prev) => {
          const filtered = prev.filter((p) => !p.path.startsWith(node.path + '/'));
          return [...filtered, ...newItems];
        });

        setTree((currentTree) => {
          const markLoaded = (nodes: FileNode[]): FileNode[] =>
            nodes.map((n) => {
              if (n.path === node.path) return { ...n, isLoaded: true };
              if (n.children?.length) return { ...n, children: markLoaded(n.children) };
              return n;
            });
          return markLoaded(currentTree);
        });
      } catch (err) {
        console.error('Failed to load children', err);
      }
    },
    [projectId, taskId]
  );

  const handleToggleExpand = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        saveEditorState(taskId, { expandedPaths: [...next] });
        return next;
      });
    },
    [taskId]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No files
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-1" role="tree">
        {tree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            level={0}
            selectedPath={activeFilePath}
            expandedPaths={expandedPaths}
            onToggleExpand={handleToggleExpand}
            onSelect={loadFile}
            onOpen={loadFile}
            onLoadChildren={loadChildren}
            fileChanges={fileChanges}
          />
        ))}
      </div>
    </div>
  );
}

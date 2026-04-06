import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileIcon } from './FileIcons';
import { useContentSearch } from '@/hooks/useContentSearch';
import { SearchInput } from './SearchInput';
import { ContentSearchResults } from './ContentSearchResults';
import { getEditorState, saveEditorState } from '@/lib/editorStateStorage';
import type { FileChange } from '@/hooks/useFileChanges';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
// Browser-compatible path utilities (renderer can't use Node's 'path' module)
const pathUtils = {
  dirname: (p: string) => p.substring(0, p.lastIndexOf('/')) || '.',
  join: (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
  relative: (from: string, to: string) => {
    const fromParts = from.split('/').filter(Boolean);
    const toParts = to.split('/').filter(Boolean);
    let i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
    const up = fromParts.slice(i).map(() => '..');
    return [...up, ...toParts.slice(i)].join('/') || '.';
  },
};

export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  isHidden?: boolean;
  extension?: string;
  isLoaded?: boolean;
}

export const constructSubRoot = (rootPath: string, nodePath: string): string => {
  const separator = rootPath.includes('\\') ? '\\' : '/';
  return rootPath.endsWith(separator)
    ? `${rootPath}${nodePath}`
    : `${rootPath}${separator}${nodePath}`;
};

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

interface FileTreeProps {
  taskId: string;
  rootPath: string;
  selectedFile?: string | null;
  onSelectFile: (path: string) => void;
  onOpenFile?: (path: string) => void;
  className?: string;
  showHiddenFiles?: boolean;
  excludePatterns?: string[];
  fileChanges?: FileChange[];
  connectionId?: string | null;
  remotePath?: string | null;
}

// Tree node component
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

  onContextMenuNewFile?: (node: FileNode) => void;
  onContextMenuNewFolder?: (node: FileNode) => void;
  onContextMenuRename?: (node: FileNode) => void;
  onContextMenuDelete?: (node: FileNode) => void;
  onContextMenuCopyPath?: (node: FileNode) => void;
  onContextMenuCopyRelPath?: (node: FileNode) => void;
  onContextMenuOpenTerminal?: (node: FileNode) => void;
  onContextMenuReveal?: (node: FileNode) => void;
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
  onContextMenuNewFile,
  onContextMenuNewFolder,
  onContextMenuRename,
  onContextMenuDelete,
  onContextMenuCopyPath,
  onContextMenuCopyRelPath,
  onContextMenuOpenTerminal,
  onContextMenuReveal,
}) => {
  // Guard: if node is null or missing type, don't render
  if (!node || !node.type) {
    return null;
  }

  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  // Determine file status from git changes
  const fileStatus = fileChanges.find((change) => change.path === node.path)?.status;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'directory') {
      // If not expanded and not loaded, load children
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>
          <div
            className={cn(
              'flex h-7 cursor-pointer select-none items-center gap-1.5 px-2 hover:bg-accent/50',
              isSelected && 'bg-accent',
              node.isHidden && 'opacity-60'
            )}
            style={{ paddingLeft: `${level * 16 + 8}px` }}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={node.type === 'directory' ? isExpanded : undefined}
          >
            {node.type === 'directory' ? (
              <span className="flex shrink-0 items-center text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </span>
            ) : (
              <span className="inline-block h-3.5 w-3.5 shrink-0" />
            )}
            <span className="flex shrink-0 items-center">
              <FileIcon
                filename={node.name}
                isDirectory={node.type === 'directory'}
                isExpanded={isExpanded}
                size={15}
              />
            </span>
            <span
              className={cn(
                'flex-1 truncate text-xs',
                fileStatus === 'added' && 'text-green-500',
                fileStatus === 'modified' && 'text-amber-500',
                fileStatus === 'deleted' && 'text-red-500 line-through',
                fileStatus === 'renamed' && 'text-blue-500'
              )}
            >
              {node.name}
            </span>
          </div>

          {node.type === 'directory' && isExpanded && node.children && node.children.length > 0 && (
            <div>
              {node.children
                .filter((child) => child && child.id && child.type)
                .map((child) => (
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
                    onContextMenuNewFile={onContextMenuNewFile}
                    onContextMenuNewFolder={onContextMenuNewFolder}
                    onContextMenuRename={onContextMenuRename}
                    onContextMenuDelete={onContextMenuDelete}
                    onContextMenuCopyPath={onContextMenuCopyPath}
                    onContextMenuCopyRelPath={onContextMenuCopyRelPath}
                    onContextMenuOpenTerminal={onContextMenuOpenTerminal}
                    onContextMenuReveal={onContextMenuReveal}
                  />
                ))}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {node.type === 'directory' && (
          <>
            <ContextMenuItem onSelect={() => onContextMenuNewFile?.(node)}>
              New File
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onContextMenuNewFolder?.(node)}>
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => onContextMenuRename?.(node)}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={() => onContextMenuDelete?.(node)}>Delete</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onContextMenuCopyPath?.(node)}>Copy Path</ContextMenuItem>
        <ContextMenuItem onSelect={() => onContextMenuCopyRelPath?.(node)}>
          Copy Relative Path
        </ContextMenuItem>
        {node.type === 'file' && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onContextMenuOpenTerminal?.(node)}>
              Open in Terminal
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onContextMenuReveal?.(node)}>
              Reveal in Finder
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({
  taskId,
  rootPath,
  selectedFile,
  onSelectFile,
  onOpenFile,
  className,
  showHiddenFiles = false,
  excludePatterns = [],
  fileChanges = [],
  connectionId,
  remotePath,
}) => {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const state = getEditorState(taskId);
    return new Set(state?.expandedPaths ?? []);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState<any[]>([]);
  const restoringRef = useRef(true);
  const loadingPathsRef = useRef(new Set<string>());

  // Context menu state
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
  const [isNewFolderDialogOpen, setIsNewFolderDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [newItemValue, setNewItemValue] = useState('');
  const [renamingNode, setRenamingNode] = useState<FileNode | null>(null);

  // Use the clean content search hook
  const {
    searchQuery,
    searchResults,
    isSearching,
    error: searchError,
    handleSearchChange,
    clearSearch,
  } = useContentSearch(rootPath, { connectionId, remotePath });

  const defaultExcludePatterns = useMemo(
    () => [
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
      'delete-github',
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
    ],
    []
  );

  const allExcludePatterns = useMemo(
    () => [...defaultExcludePatterns, ...excludePatterns],
    [defaultExcludePatterns, excludePatterns]
  );

  const remoteArgs = useMemo(
    () =>
      connectionId && remotePath
        ? { connectionId: connectionId, remotePath: remotePath }
        : undefined,
    [connectionId, remotePath]
  );

  // Check if an item should be excluded
  const shouldExclude = useCallback(
    (path: string): boolean => {
      const parts = path.split('/');
      return parts.some((part) => {
        const lowerPart = part.toLowerCase();
        return allExcludePatterns.some((pattern) => {
          const lowerPattern = pattern.toLowerCase();

          // Handle glob patterns (simplistic version)
          if (lowerPattern.includes('*')) {
            // Convert glob to regex: . -> \., * -> .*
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

  // Build tree nodes from path
  const buildNodesFromPath = useCallback(
    (dirPath: string, files: any[]): FileNode[] => {
      const immediateChildren = new Map<string, { type: 'file' | 'dir' }>();

      files.forEach((item) => {
        if (!item || !item.path || !item.type) {
          return;
        }
        // Skip excluded items
        if (shouldExclude(item.path)) {
          return;
        }

        if (dirPath) {
          if (!item.path.startsWith(dirPath + '/')) {
            return;
          }
          // Remove the dirPath prefix to get relative path
          const relativePath = item.path.substring(dirPath.length + 1);

          // Get the first part only (immediate child)
          const firstSlashIndex = relativePath.indexOf('/');
          if (firstSlashIndex === -1) {
            // It's a file in this directory
            if (!showHiddenFiles && relativePath.startsWith('.')) {
              return;
            }
            immediateChildren.set(relativePath, { type: item.type });
          } else {
            // It's a subdirectory or file in a subdirectory
            const immediateChild = relativePath.substring(0, firstSlashIndex);
            if (!showHiddenFiles && immediateChild.startsWith('.')) {
              return;
            }
            // Mark it as a directory since it has children
            immediateChildren.set(immediateChild, { type: 'dir' });
          }
        } else {
          // We're at root - extract first part of path
          const firstSlashIndex = item.path.indexOf('/');
          if (firstSlashIndex === -1) {
            // It's a file at root
            if (!showHiddenFiles && item.path.startsWith('.')) {
              return;
            }
            immediateChildren.set(item.path, { type: item.type });
          } else {
            // It's a directory or file in a subdirectory
            const immediateChild = item.path.substring(0, firstSlashIndex);
            if (!showHiddenFiles && immediateChild.startsWith('.')) {
              return;
            }
            immediateChildren.set(immediateChild, { type: 'dir' });
          }
        }
      });

      // Convert map to array of FileNodes
      const nodes: FileNode[] = [];
      immediateChildren.forEach((itemInfo, itemName) => {
        // Guard: skip if itemInfo is null
        if (!itemInfo || !itemInfo.type) {
          return;
        }
        const nodePath = dirPath ? `${dirPath}/${itemName}` : itemName;
        nodes.push({
          id: nodePath,
          name: itemName,
          path: nodePath,
          type: itemInfo.type === 'dir' ? 'directory' : 'file',
          children: itemInfo.type === 'dir' ? [] : undefined,
          isHidden: itemName.startsWith('.'),
          extension:
            itemInfo.type === 'file' && itemName.includes('.')
              ? itemName.split('.').pop()
              : undefined,
          isLoaded: false,
        });
      });

      // Sort: directories first, then alphabetically
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return nodes;
    },
    [showHiddenFiles, shouldExclude]
  );

  // Load all files once at the beginning - only when rootPath changes
  const loadAllFiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const opts: {
        includeDirs: boolean;
        connectionId?: string;
        remotePath?: string;
      } = { includeDirs: true };

      if (connectionId && remotePath) {
        opts.connectionId = connectionId;
        opts.remotePath = remotePath;
      }

      const result = await window.electronAPI.fsList(rootPath, {
        ...opts,
        recursive: false,
      });

      if (result.canceled) {
        return;
      }

      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to load files');
      }

      // Store all files for later use (filter out null/undefined items)
      const validItems = result.items.filter((item: any) => item && item.path && item.type);
      setAllFiles(validItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [rootPath, connectionId, remotePath]); // Reload when rootPath or remote info changes

  useEffect(() => {
    void loadAllFiles();
  }, [loadAllFiles]);

  // Build tree when files or filters change
  useEffect(() => {
    if (allFiles.length === 0) return;

    // Build tree with current filters
    const rootNodes = buildNodesFromPath('', allFiles);

    // Preserve expanded state when rebuilding tree
    setTree((prevTree) => {
      // If this is the first load, just set the tree
      if (prevTree.length === 0) {
        return rootNodes;
      }

      // Otherwise, preserve the isLoaded state from previous tree
      const preserveLoadedState = (newNodes: FileNode[], oldNodes: FileNode[]): FileNode[] => {
        return newNodes.map((newNode) => {
          const oldNode = oldNodes.find((n) => n.path === newNode.path);
          if (oldNode && oldNode.isLoaded && oldNode.children) {
            // Preserve the loaded children
            return {
              ...newNode,
              isLoaded: true,
              children: preserveLoadedState(
                buildNodesFromPath(newNode.path, allFiles),
                oldNode.children
              ),
            };
          }
          return newNode;
        });
      };

      return preserveLoadedState(rootNodes, prevTree);
    });
  }, [allFiles, buildNodesFromPath]); // Rebuild tree when files or filter function changes

  // Context menu handlers
  const getParentPath = (node: FileNode): string => {
    const dir = pathUtils.dirname(node.path);
    return dir === '.' ? '' : dir;
  };

  const getTargetDirectoryPath = (node: FileNode): string => {
    return node.type === 'directory' ? node.path : getParentPath(node);
  };

  const handleCopyPath = async (node: FileNode) => {
    const absPath = pathUtils.join(rootPath, node.path);
    await window.electronAPI.clipboardWriteText(absPath);
  };

  const handleCopyRelativePath = async (node: FileNode) => {
    await window.electronAPI.clipboardWriteText(node.path);
  };

  const handleOpenTerminal = async (node: FileNode) => {
    const dirPath =
      node.type === 'directory'
        ? pathUtils.join(rootPath, node.path)
        : pathUtils.join(rootPath, pathUtils.dirname(node.path));
    await window.electronAPI.openIn({ app: 'terminal', path: dirPath });
  };

  const handleRevealInFinder = async (node: FileNode) => {
    const filePath = pathUtils.join(rootPath, node.path);
    await window.electronAPI.openIn({ app: 'finder', path: filePath });
  };

  const handleRenameClick = (node: FileNode) => {
    setRenamingNode(node);
    setRenameValue(node.name);
    setIsRenameDialogOpen(true);
  };

  const handleDeleteClick = (node: FileNode) => {
    setSelectedNode(node);
    setIsDeleteDialogOpen(true);
  };

  const handleNewFileClick = (node: FileNode) => {
    setSelectedNode(node);
    setNewItemValue('');
    setIsNewFileDialogOpen(true);
  };

  const handleNewFolderClick = (node: FileNode) => {
    setSelectedNode(node);
    setNewItemValue('');
    setIsNewFolderDialogOpen(true);
  };

  const confirmRename = async () => {
    if (!renamingNode || !renameValue.trim() || renameValue === renamingNode.name) {
      setIsRenameDialogOpen(false);
      return;
    }
    const parentPath = getParentPath(renamingNode);
    const oldRelPath = renamingNode.path;
    const newRelPath = parentPath ? `${parentPath}/${renameValue.trim()}` : renameValue.trim();
    const result = await window.electronAPI.fsRename(rootPath, oldRelPath, newRelPath, remoteArgs);
    if (!result.success) {
      setError(result.error ?? 'Failed to rename file or directory');
      return;
    }
    await loadAllFiles();
    setIsRenameDialogOpen(false);
    setRenamingNode(null);
  };

  const confirmDelete = async () => {
    if (!selectedNode) return;
    if (selectedNode.type === 'directory') {
      const result = await window.electronAPI.fsRmdir(rootPath, selectedNode.path, remoteArgs);
      if (!result.success) {
        setError(result.error ?? 'Failed to remove directory');
        return;
      }
    } else {
      const result = await window.electronAPI.fsRemove(rootPath, selectedNode.path, remoteArgs);
      if (!result.success) {
        setError(result.error ?? 'Failed to remove file');
        return;
      }
    }
    await loadAllFiles();
    setIsDeleteDialogOpen(false);
    setSelectedNode(null);
  };

  const confirmNewFile = async () => {
    if (!selectedNode || !newItemValue.trim()) {
      setIsNewFileDialogOpen(false);
      return;
    }
    const parentPath = getTargetDirectoryPath(selectedNode);
    const relPath = parentPath ? `${parentPath}/${newItemValue.trim()}` : newItemValue.trim();
    const result = await window.electronAPI.fsWriteFile(rootPath, relPath, '', true, remoteArgs);
    if (!result.success) {
      setError(result.error ?? 'Failed to create file');
      return;
    }
    await loadAllFiles();
    setIsNewFileDialogOpen(false);
    setSelectedNode(null);
  };

  const confirmNewFolder = async () => {
    if (!selectedNode || !newItemValue.trim()) {
      setIsNewFolderDialogOpen(false);
      return;
    }
    const parentPath = getTargetDirectoryPath(selectedNode);
    const relPath = parentPath ? `${parentPath}/${newItemValue.trim()}` : newItemValue.trim();
    const result = await window.electronAPI.fsMkdir(rootPath, relPath, remoteArgs);
    if (!result.success) {
      setError(result.error ?? 'Failed to create directory');
      return;
    }
    await loadAllFiles();
    setIsNewFolderDialogOpen(false);
    setSelectedNode(null);
  };

  // Load children for a node
  const loadChildren = useCallback(
    async (node: FileNode) => {
      // If already loaded, just toggle (handled by click handler, but nice to be safe)
      if (node.isLoaded) return;

      try {
        const subRoot = constructSubRoot(rootPath, node.path);

        const opts: {
          includeDirs: boolean;
          recursive: boolean;
          connectionId?: string;
          remotePath?: string;
        } = {
          includeDirs: true,
          recursive: false,
        };
        if (connectionId && remotePath) {
          opts.connectionId = connectionId;
          opts.remotePath = remotePath;
        }

        const result = await window.electronAPI.fsList(subRoot, opts);

        if (result.success && result.items) {
          // Process new items:
          // 1. Prefix their paths so they are relative to project root
          // 2. Add them to allFiles
          // Guard: filter out null/undefined items
          const newItems = result.items
            .filter((item: any) => item && item.path && item.type)
            .map((item: any) => ({
              ...item,
              path: `${node.path}/${item.path}`, // item.path from fsList is relative to subRoot
            }));

          setAllFiles((prev) => {
            // Remove any existing children of this node to avoid duplicates (optional but good)
            const filtered = prev.filter((p) => !p.path.startsWith(node.path + '/'));
            return [...filtered, ...newItems];
          });

          // Mark node as loaded to prevent re-fetching and allow expansion
          setTree((currentTree) => {
            const updateNode = (nodes: FileNode[]): FileNode[] => {
              return nodes.map((n) => {
                if (n.path === node.path) {
                  return { ...n, isLoaded: true };
                }
                if (n.children && n.children.length > 0) {
                  return { ...n, children: updateNode(n.children) };
                }
                return n;
              });
            };
            return updateNode(currentTree);
          });
        }
      } catch (error) {
        console.error('Failed to load children', error);
      }
    },
    [rootPath, connectionId, remotePath]
  );

  useEffect(() => {
    restoringRef.current = true;
    const state = getEditorState(taskId);
    setExpandedPaths(new Set(state?.expandedPaths ?? []));
  }, [taskId]);

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
    if (node) {
      loadingPathsRef.current.add(path);
      void loadChildren(node).finally(() => {
        loadingPathsRef.current.delete(path);
      });
    }
  }, [taskId, tree, expandedPaths, loadChildren]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Persist expandedPaths to localStorage (skip during restore)
  useEffect(() => {
    if (restoringRef.current) {
      restoringRef.current = false;
      return;
    }
    saveEditorState(taskId, { expandedPaths: Array.from(expandedPaths) });
  }, [taskId, expandedPaths]);

  // Handle clicking on a search result
  const handleSearchResultClick = useCallback(
    (filePath: string) => {
      onSelectFile(filePath);
      if (onOpenFile) {
        onOpenFile(filePath);
      }
    },
    [onSelectFile, onOpenFile]
  );

  if (loading) {
    return (
      <div className={cn('p-4 text-sm text-muted-foreground', className)}>Loading files...</div>
    );
  }

  if (error) {
    return <div className={cn('p-4 text-sm text-destructive', className)}>Error: {error}</div>;
  }

  if (tree.length === 0) {
    return <div className={cn('p-4 text-sm text-muted-foreground', className)}>No files found</div>;
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div>
        <SearchInput
          value={searchQuery}
          onChange={handleSearchChange}
          onClear={clearSearch}
          placeholder="Search..."
        />
      </div>

      <div className="flex-1 overflow-auto">
        {searchQuery ? (
          // Search results view
          <div className="p-2">
            <ContentSearchResults
              results={searchResults}
              isSearching={isSearching}
              error={searchError}
              onResultClick={handleSearchResultClick}
            />
          </div>
        ) : (
          // File tree view
          <div role="tree" aria-label="File explorer">
            {tree
              .filter((child) => child && child.id && child.type)
              .map((child) => (
                <TreeNode
                  key={child.id}
                  node={child}
                  level={0}
                  selectedPath={selectedFile}
                  expandedPaths={expandedPaths}
                  onToggleExpand={handleToggleExpand}
                  onSelect={onSelectFile}
                  onOpen={onOpenFile}
                  onLoadChildren={loadChildren}
                  fileChanges={fileChanges}
                  onContextMenuNewFile={handleNewFileClick}
                  onContextMenuNewFolder={handleNewFolderClick}
                  onContextMenuRename={handleRenameClick}
                  onContextMenuDelete={handleDeleteClick}
                  onContextMenuCopyPath={handleCopyPath}
                  onContextMenuCopyRelPath={handleCopyRelativePath}
                  onContextMenuOpenTerminal={handleOpenTerminal}
                  onContextMenuReveal={handleRevealInFinder}
                />
              ))}
          </div>
        )}
      </div>

      {/* Rename Dialog */}
      <AlertDialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new name for "{renamingNode?.name}"
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRename}>Rename</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedNode?.type === 'directory' ? 'Folder' : 'File'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedNode?.name}"?
              {selectedNode?.type === 'directory' && ' This will delete all contents.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 px-4 py-2 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New File Dialog */}
      <AlertDialog open={isNewFileDialogOpen} onOpenChange={setIsNewFileDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New File</AlertDialogTitle>
            <AlertDialogDescription>
              Create a new file in "
              {(selectedNode ? getTargetDirectoryPath(selectedNode) : '') || 'root'}"
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={newItemValue}
            onChange={(e) => setNewItemValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmNewFile()}
            placeholder="filename.ext"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNewFile}>Create</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Folder Dialog */}
      <AlertDialog open={isNewFolderDialogOpen} onOpenChange={setIsNewFolderDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Create a new folder in "
              {(selectedNode ? getTargetDirectoryPath(selectedNode) : '') || 'root'}"
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={newItemValue}
            onChange={(e) => setNewItemValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmNewFolder()}
            placeholder="folder name"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNewFolder}>Create</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FileTree;

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileIcon } from './FileIcons';
import { useContentSearch } from '@/hooks/useContentSearch';
import { SearchInput } from './SearchInput';
import { ContentSearchResults } from './ContentSearchResults';

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

interface FileTreeProps {
  rootPath: string;
  selectedFile?: string | null;
  onSelectFile: (path: string) => void;
  onOpenFile?: (path: string) => void;
  className?: string;
  showHiddenFiles?: boolean;
  excludePatterns?: string[];
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
}> = ({
  node,
  level,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onSelect,
  onOpen,
  onLoadChildren,
}) => {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

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
        <span className="flex-1 truncate text-sm">{node.name}</span>
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({
  rootPath,
  selectedFile,
  onSelectFile,
  onOpenFile,
  className,
  showHiddenFiles = false,
  excludePatterns = [],
}) => {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState<any[]>([]);

  // Use the clean content search hook
  const {
    searchQuery,
    searchResults,
    isSearching,
    error: searchError,
    handleSearchChange,
    clearSearch,
  } = useContentSearch(rootPath);

  const defaultExcludePatterns = useMemo(
    () => [
      'node_modules',
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

  // Check if an item should be excluded
  const shouldExclude = useCallback(
    (path: string): boolean => {
      const parts = path.split('/');
      return parts.some((part) => {
        const lowerPart = part.toLowerCase();
        return allExcludePatterns.some((pattern) => {
          const lowerPattern = pattern.toLowerCase();
          return lowerPart === lowerPattern || lowerPart.includes(lowerPattern);
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
  useEffect(() => {
    const loadAllFiles = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await window.electronAPI.fsList(rootPath, { includeDirs: true });

        if (!result.success || !result.items) {
          throw new Error(result.error || 'Failed to load files');
        }

        // Store all files for later use
        setAllFiles(result.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load files');
      } finally {
        setLoading(false);
      }
    };

    loadAllFiles();
  }, [rootPath]); // Only reload when rootPath changes

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

  // Load children for a node using the cached file list
  const loadChildren = useCallback(
    async (node: FileNode) => {
      const children = buildNodesFromPath(node.path, allFiles);

      setTree((currentTree) => {
        const updateNode = (nodes: FileNode[]): FileNode[] => {
          return nodes.map((n) => {
            if (n.path === node.path) {
              return { ...n, children, isLoaded: true };
            }
            if (n.children && n.children.length > 0) {
              return { ...n, children: updateNode(n.children) };
            }
            return n;
          });
        };

        return updateNode(currentTree);
      });
    },
    [allFiles, buildNodesFromPath]
  );

  // Toggle expand/collapse
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
            {tree.map((child) => (
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileTree;

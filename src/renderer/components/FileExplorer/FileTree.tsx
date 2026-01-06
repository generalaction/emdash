import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileIcon } from './FileIcons';

// File node interface matching VS Code's structure
export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  modified?: number;
  isSymlink?: boolean;
  isHidden?: boolean;
  extension?: string;
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
}> = ({ node, level, selectedPath, expandedPaths, onToggleExpand, onSelect, onOpen }) => {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'directory') {
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
        <span className="mr-1.5">
          <FileIcon
            filename={node.name}
            isDirectory={node.type === 'directory'}
            isExpanded={isExpanded}
          />
        </span>
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
  const [tree, setTree] = useState<FileNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default exclude patterns (VS Code defaults)
  const defaultExcludePatterns = useMemo(
    () => [
      '**/node_modules',
      '**/.git',
      '**/dist',
      '**/build',
      '**/.next',
      '**/out',
      '**/.turbo',
      '**/coverage',
      '**/.nyc_output',
      '**/.cache',
      '**/tmp',
      '**/temp',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.log',
      '**/.vscode-test',
      '**/.idea',
      '**/__pycache__',
      '**/.pytest_cache',
      '**/venv',
      '**/.venv',
      '**/target',
      '**/.terraform',
      '**/.serverless',
    ],
    []
  );

  const allExcludePatterns = useMemo(
    () => [...defaultExcludePatterns, ...excludePatterns],
    [defaultExcludePatterns, excludePatterns]
  );

  // Load directory contents
  const loadDirectory = useCallback(
    async (dirPath: string): Promise<FileNode[]> => {
      try {
        const fullPath = dirPath ? `${rootPath}/${dirPath}` : rootPath;
        const result = await window.electronAPI.fsList(fullPath, { includeDirs: true });

        if (!result.success || !result.items) {
          console.error('Failed to load directory:', result.error);
          return [];
        }

        // Filter and sort items
        let items = result.items;

        // Apply filtering
        if (!showHiddenFiles) {
          items = items.filter((item) => !item.path.startsWith('.'));
        }

        // Apply exclude patterns (simplified for now)
        items = items.filter((item) => {
          const itemPath = item.path.toLowerCase();
          return !allExcludePatterns.some((pattern) => {
            const simplePattern = pattern.replace('**/', '').replace('*', '');
            return itemPath.includes(simplePattern.toLowerCase());
          });
        });

        // Sort: directories first, then alphabetically
        items.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'dir' ? -1 : 1;
          }
          return a.path.localeCompare(b.path);
        });

        // Convert to FileNode structure
        return items.map((item) => ({
          id: `${dirPath}/${item.path}`,
          name: item.path,
          path: dirPath ? `${dirPath}/${item.path}` : item.path,
          type: item.type === 'dir' ? 'directory' : 'file',
          children: item.type === 'dir' ? [] : undefined,
          isHidden: item.path.startsWith('.'),
          extension: item.path.includes('.') ? item.path.split('.').pop() : undefined,
        }));
      } catch (error) {
        console.error('Error loading directory:', error);
        return [];
      }
    },
    [rootPath, showHiddenFiles, allExcludePatterns]
  );

  // Initial load
  useEffect(() => {
    const loadInitialTree = async () => {
      setLoading(true);
      setError(null);

      try {
        const children = await loadDirectory('');
        const rootNode: FileNode = {
          id: 'root',
          name: rootPath.split('/').pop() || 'root',
          path: '',
          type: 'directory',
          children,
        };
        setTree(rootNode);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load files');
      } finally {
        setLoading(false);
      }
    };

    loadInitialTree();
  }, [rootPath, loadDirectory]);

  // Toggle expand/collapse
  const handleToggleExpand = useCallback(
    async (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);

          // Load children if not loaded yet
          if (tree) {
            const findAndLoadNode = async (node: FileNode): Promise<void> => {
              if (node.path === path && node.type === 'directory' && node.children?.length === 0) {
                const children = await loadDirectory(path);
                setTree((currentTree) => {
                  if (!currentTree) return currentTree;

                  const updateNode = (n: FileNode): FileNode => {
                    if (n.path === path) {
                      return { ...n, children };
                    }
                    if (n.children) {
                      return { ...n, children: n.children.map(updateNode) };
                    }
                    return n;
                  };

                  return updateNode(currentTree);
                });
              } else if (node.children) {
                await Promise.all(node.children.map(findAndLoadNode));
              }
            };

            findAndLoadNode(tree);
          }
        }
        return next;
      });
    },
    [tree, loadDirectory]
  );

  if (loading) {
    return (
      <div className={cn('p-4 text-sm text-muted-foreground', className)}>Loading files...</div>
    );
  }

  if (error) {
    return <div className={cn('p-4 text-sm text-destructive', className)}>Error: {error}</div>;
  }

  if (!tree) {
    return <div className={cn('p-4 text-sm text-muted-foreground', className)}>No files found</div>;
  }

  return (
    <div className={cn('overflow-auto', className)} role="tree" aria-label="File explorer">
      {tree.children?.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          level={0}
          selectedPath={selectedFile}
          expandedPaths={expandedPaths}
          onToggleExpand={handleToggleExpand}
          onSelect={onSelectFile}
          onOpen={onOpenFile}
        />
      ))}
    </div>
  );
};

export default FileTree;

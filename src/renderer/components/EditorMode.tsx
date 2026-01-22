import React, { useState, useCallback, useEffect } from 'react';
import {
  X,
  RefreshCw,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  PanelRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { getMonacoLanguageId } from '@/lib/diffUtils';
import { useTheme } from '@/hooks/useTheme';
import { useRightSidebar } from './ui/right-sidebar';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface EditorModeProps {
  taskPath: string;
  taskName: string;
  onClose: () => void;
}

export default function EditorMode({ taskPath, taskName, onClose }: EditorModeProps) {
  const { effectiveTheme } = useTheme();
  const { toggle: toggleRightSidebar, collapsed: rightSidebarCollapsed } = useRightSidebar();

  const [files, setFiles] = useState<FileNode | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(250);
  const [isResizing, setIsResizing] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showIgnoredFiles, setShowIgnoredFiles] = useState(false);

  // Whitelist approach - only show files we explicitly want
  const shouldIncludeFile = (fullPath: string): boolean => {
    const lowerPath = fullPath.toLowerCase();

    // IMMEDIATELY REJECT anything with these ANYWHERE in the path
    const blacklistPatterns = [
      'checkout', // This catches .checkouts, checkouts, etc
      'delete-github',
      'node_modules',
      '.git',
      'dist/',
      'build/',
      'coverage',
      'tmp',
      'temp',
      'cache',
      'vendor',
      'releases',
      'release/',
      'logs',
      '.turbo',
      '.next',
      'out/',
      '_build',
      'target/',
      '.conductor',
      '.cursor',
      '.claude',
      '.amp',
      '.codex',
      'worktree',
      '.aider',
      '.continue',
      '.cody',
      '.windsurf',
    ];

    // Check each pattern
    for (const pattern of blacklistPatterns) {
      if (lowerPath.includes(pattern)) {
        return false; // Exclude
      }
    }

    // Check file extension - only allow source code files
    const allowedExtensions = [
      // Web
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.vue',
      '.svelte',
      '.html',
      '.css',
      '.scss',
      '.sass',
      '.less',

      // Config
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.xml',
      '.env',
      '.env.example',

      // Docs
      '.md',
      '.mdx',
      '.txt',
      '.rst',

      // Programming languages
      '.py',
      '.rb',
      '.php',
      '.java',
      '.kt',
      '.scala',
      '.go',
      '.rs',
      '.c',
      '.cpp',
      '.h',
      '.hpp',
      '.cs',
      '.swift',
      '.m',
      '.mm',
      '.sh',
      '.bash',
      '.zsh',
      '.fish',
      '.ps1',
      '.bat',
      '.cmd',

      // Config files (no extension)
      'dockerfile',
      'makefile',
      'rakefile',
      'gemfile',
      '.gitignore',
      '.prettierrc',
      '.eslintrc',
      '.babelrc',
      '.editorconfig',
      '.gitattributes',
    ];

    const fileName = fullPath.split('/').pop() || '';
    const lowerFileName = fileName.toLowerCase();

    // Check if it's a directory (no extension usually means directory)
    const hasExtension = fileName.includes('.');
    if (!hasExtension) {
      // For directories, only allow non-hidden ones and specific hidden ones
      if (fileName.startsWith('.')) {
        const allowedHiddenDirs = ['.github', '.vscode', '.gitlab'];
        return allowedHiddenDirs.includes(fileName);
      }
      // Non-hidden directory - allow it (already passed blacklist check)
      return true;
    }

    // For files, check if extension is allowed
    for (const ext of allowedExtensions) {
      if (lowerFileName.endsWith(ext) || lowerFileName === ext) {
        return true;
      }
    }

    return false; // Exclude everything else
  };

  // Load file tree
  const loadFileTree = useCallback(async () => {
    setIsLoading(true);
    try {
      // Use the existing fsRead API to list directory contents
      const result = await window.electronAPI.fsList(taskPath, { includeDirs: true });

      if (result.success && result.items) {
        // Filter using whitelist approach
        const filteredItems = showIgnoredFiles
          ? result.items
          : result.items.filter((item) => shouldIncludeFile(item.path));

        // Sort items: directories first, then files, both alphabetically
        const sortedItems = filteredItems.sort((a, b) => {
          // Directories come before files
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          // Within same type, sort alphabetically
          return a.path.localeCompare(b.path);
        });

        // Build a simple tree structure
        const tree: FileNode = {
          name: taskPath.split('/').pop() || 'root',
          path: '',
          type: 'directory',
          children: sortedItems.map((item) => ({
            name: item.path,
            path: item.path,
            type: item.type === 'dir' ? 'directory' : 'file',
            children: item.type === 'dir' ? [] : undefined,
          })),
        };
        setFiles(tree);
      }
    } catch (error) {
      // Error loading files - handled silently
    } finally {
      setIsLoading(false);
    }
  }, [taskPath, showIgnoredFiles]);

  // Load file tree on mount
  useEffect(() => {
    loadFileTree();
  }, [loadFileTree]);

  // Track unsaved changes
  useEffect(() => {
    if (selectedFile && fileContent !== originalContent) {
      setHasUnsavedChanges(true);
    } else {
      setHasUnsavedChanges(false);
    }
  }, [fileContent, originalContent, selectedFile]);

  // Auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (!hasUnsavedChanges || !selectedFile) return;

    const timer = setTimeout(() => {
      saveFile();
    }, 2000);

    return () => clearTimeout(timer);
  }, [fileContent, hasUnsavedChanges, selectedFile]);

  // Load file content
  const loadFile = async (filePath: string) => {
    try {
      const result = await window.electronAPI.fsRead(taskPath, filePath);

      if (result.success && result.content !== undefined) {
        setFileContent(result.content);
        setOriginalContent(result.content);
        setSelectedFile(filePath);
        setHasUnsavedChanges(false);
      } else {
        setFileContent('// Failed to load file');
        setOriginalContent('// Failed to load file');
      }
    } catch {
      setFileContent('// Error loading file');
      setOriginalContent('// Error loading file');
    }
  };

  // Save file
  const saveFile = async () => {
    if (!selectedFile) return;

    setIsSaving(true);
    const fullSavePath = `${taskPath}/${selectedFile}`;

    try {
      const result = await window.electronAPI.fsWriteFile(
        taskPath,
        selectedFile,
        fileContent,
        true
      );

      if (!result.success) {
        alert(`Failed to save file: ${result.error}\nPath: ${fullSavePath}`);
      } else {
        setOriginalContent(fileContent);
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      alert(`Error saving file: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle keyboard shortcut for save
  const handleEditorMount = (editor: any, monaco: any) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile();
    });
  };

  // Load subdirectory contents
  const loadSubdirectory = async (dirPath: string): Promise<FileNode[]> => {
    try {
      const fullPath = dirPath ? `${taskPath}/${dirPath}` : taskPath;
      const result = await window.electronAPI.fsList(fullPath, { includeDirs: true });

      if (result.success && result.items) {
        // Filter using whitelist approach
        const filteredItems = showIgnoredFiles
          ? result.items
          : result.items.filter((item) => shouldIncludeFile(item.path));

        // Sort items: directories first, then files, both alphabetically
        const sortedItems = filteredItems.sort((a, b) => {
          // Directories come before files
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          // Within same type, sort alphabetically
          return a.path.localeCompare(b.path);
        });

        return sortedItems.map((item) => ({
          name: item.path.split('/').pop() || item.path,
          path: dirPath ? `${dirPath}/${item.path}` : item.path,
          type: item.type === 'dir' ? 'directory' : 'file',
          children: item.type === 'dir' ? [] : undefined,
        }));
      }
      return [];
    } catch (error) {
      console.error('Failed to load subdirectory:', error);
      return [];
    }
  };

  // Update file tree with subdirectory contents
  const updateNodeChildren = (node: FileNode, path: string, children: FileNode[]): FileNode => {
    if (node.path === path) {
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: node.children.map((child) => updateNodeChildren(child, path, children)),
      };
    }
    return node;
  };

  // Toggle directory expansion
  const toggleDir = async (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);

      // Load subdirectory contents if not already loaded
      if (files) {
        const children = await loadSubdirectory(path);
        setFiles(updateNodeChildren(files, path, children));
      }
    }
    setExpandedDirs(newExpanded);
  };

  // Handle resize
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = explorerWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(150, Math.min(500, startWidth + e.clientX - startX));
      setExplorerWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Render file tree recursively
  const renderFileTree = (node: FileNode, level: number = 0) => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = selectedFile === node.path;

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex h-7 cursor-pointer items-center px-2 hover:bg-muted/50',
            isSelected && 'bg-muted/70'
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => {
            if (node.type === 'file') {
              loadFile(node.path);
            } else {
              toggleDir(node.path);
            }
          }}
        >
          {node.type === 'directory' && (
            <div className="mr-1">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
          )}
          {node.type === 'directory' ? (
            <FolderOpen className="mr-2 h-4 w-4 text-blue-500" />
          ) : (
            <FileText className="mr-2 h-4 w-4 text-gray-500" />
          )}
          <span className="truncate text-sm">{node.name}</span>
        </div>
        {node.type === 'directory' && isExpanded && node.children && (
          <div>{node.children.map((child) => renderFileTree(child, level + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-background">
      <div className="flex h-12 items-center justify-between border-b border-border bg-muted/30 px-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          <span className="font-medium">{taskName} - Editor</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedFile && (
            <>
              {hasUnsavedChanges && (
                <span className="text-xs font-medium text-amber-500">● Unsaved</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={saveFile}
                disabled={isSaving || !hasUnsavedChanges}
              >
                {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save (⌘S)' : 'Saved'}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleRightSidebar}
            title={rightSidebarCollapsed ? 'Show Changes' : 'Hide Changes'}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="border-r border-border bg-muted/10" style={{ width: explorerWidth }}>
          <div className="flex h-10 items-center justify-between border-b border-border px-2">
            <span className="text-xs font-medium uppercase">Explorer</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowIgnoredFiles(!showIgnoredFiles)}
                title={showIgnoredFiles ? 'Hide ignored files' : 'Show ignored files'}
              >
                {showIgnoredFiles ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={loadFileTree}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="h-full overflow-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading files...</div>
            ) : files ? (
              renderFileTree(files)
            ) : (
              <div className="p-4 text-center text-sm text-muted-foreground">No files found</div>
            )}
          </div>

          <div
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/50"
            style={{ right: -2 }}
            onMouseDown={handleMouseDown}
          />
        </div>

        <div className="flex flex-1 flex-col">
          {selectedFile ? (
            <>
              <div className="flex h-10 items-center justify-between border-b border-border px-4">
                <div className="flex items-center">
                  <FileText className="mr-2 h-4 w-4" />
                  <span className="text-sm">{selectedFile}</span>
                  {hasUnsavedChanges && <span className="ml-2 text-xs text-amber-500">●</span>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {hasUnsavedChanges ? 'Auto-save in 2s' : 'All changes saved'}
                </span>
              </div>
              <div className="flex-1">
                <Editor
                  height="100%"
                  language={getMonacoLanguageId(selectedFile)}
                  value={fileContent}
                  onChange={(value) => setFileContent(value || '')}
                  onMount={handleEditorMount}
                  theme={
                    effectiveTheme === 'dark' || effectiveTheme === 'dark-black' ? 'vs-dark' : 'vs'
                  }
                  options={{
                    minimap: { enabled: true },
                    fontSize: 13,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    automaticLayout: true,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Select a file to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

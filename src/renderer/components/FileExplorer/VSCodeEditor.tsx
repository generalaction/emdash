import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { X, RefreshCw, FolderOpen, FileText, PanelRight, Eye, EyeOff, Save } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { getMonacoLanguageId } from '@/lib/diffUtils';
import { useTheme } from '@/hooks/useTheme';
import { useRightSidebar } from '../ui/right-sidebar';
import { FileTree } from './FileTree';

interface VSCodeEditorProps {
  taskPath: string;
  taskName: string;
  onClose: () => void;
}

interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  originalContent: string;
}

// VS Code default exclude patterns
const VS_CODE_DEFAULT_EXCLUDES = [
  '**/.git',
  '**/.svn',
  '**/.hg',
  '**/CVS',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/node_modules',
  '**/.next',
  '**/dist',
  '**/build',
  '**/.turbo',
  '**/coverage',
  '**/.nyc_output',
  '**/tmp',
  '**/.tmp',
  '**/temp',
  '**/.temp',
  '**/.cache',
  '**/.parcel-cache',
  '**/__pycache__',
  '**/.pytest_cache',
  '**/venv',
  '**/.venv',
  '**/target',
  '**/.idea',
  '**/.vscode-test',
  '**/.terraform',
  '**/.serverless',
  '**/.checkouts', // Specific to your issue
  '**/checkouts',
  '**/delete-github*',
  '**/.conductor',
  '**/.cursor',
  '**/.claude',
  '**/.amp',
  '**/.codex',
  '**/.aider',
  '**/.continue',
  '**/.cody',
  '**/.windsurf',
];

export default function VSCodeEditor({ taskPath, taskName, onClose }: VSCodeEditorProps) {
  const { effectiveTheme } = useTheme();
  const { toggle: toggleRightSidebar, collapsed: rightSidebarCollapsed } = useRightSidebar();

  // File management state
  const [openFiles, setOpenFiles] = useState<Map<string, OpenFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // UI state
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Custom exclude patterns (user configurable in real VS Code)
  const [customExcludes, setCustomExcludes] = useState<string[]>([]);

  const excludePatterns = useMemo(
    () => (showHiddenFiles ? [] : [...VS_CODE_DEFAULT_EXCLUDES, ...customExcludes]),
    [showHiddenFiles, customExcludes]
  );

  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const hasUnsavedChanges = Array.from(openFiles.values()).some((f) => f.isDirty);

  // Component mount effect
  useEffect(() => {
    // Component mounted
  }, [taskPath, taskName]);

  // Load file content
  const loadFile = useCallback(
    async (filePath: string) => {
      try {
        const result = await window.electronAPI.fsRead(taskPath, filePath);

        if (result.success && result.content !== undefined) {
          const openFile: OpenFile = {
            path: filePath,
            content: result.content,
            originalContent: result.content,
            isDirty: false,
          };

          setOpenFiles((prev) => new Map(prev).set(filePath, openFile));
          setActiveFilePath(filePath);
          setSelectedFile(filePath);
        } else {
          console.error('Failed to load file:', result.error);
        }
      } catch (error) {
        console.error('Error loading file:', error);
      }
    },
    [taskPath]
  );

  // Save file
  const saveFile = useCallback(
    async (filePath?: string) => {
      const targetPath = filePath || activeFilePath;
      if (!targetPath) return;

      const file = openFiles.get(targetPath);
      if (!file || !file.isDirty) return;

      setIsSaving(true);

      try {
        const result = await window.electronAPI.fsWriteFile(
          taskPath,
          targetPath,
          file.content,
          true
        );

        if (result.success) {
          setOpenFiles((prev) => {
            const next = new Map(prev);
            const updated = next.get(targetPath);
            if (updated) {
              updated.isDirty = false;
              updated.originalContent = updated.content;
            }
            return next;
          });
        } else {
          console.error('Failed to save:', result.error);
          alert(`Failed to save file: ${result.error}`);
        }
      } catch (error) {
        console.error('Error saving file:', error);
        alert(`Error saving file: ${error}`);
      } finally {
        setIsSaving(false);
      }
    },
    [activeFilePath, openFiles, taskPath]
  );

  // Save all files
  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = Array.from(openFiles.entries()).filter(([_, file]) => file.isDirty);

    for (const [path] of dirtyFiles) {
      await saveFile(path);
    }
  }, [openFiles, saveFile]);

  // Handle editor content change
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeFilePath || value === undefined) return;

      setOpenFiles((prev) => {
        const next = new Map(prev);
        const file = next.get(activeFilePath);
        if (file) {
          file.content = value;
          file.isDirty = value !== file.originalContent;
        }
        return next;
      });
    },
    [activeFilePath]
  );

  // Handle editor mount
  const handleEditorMount = useCallback(
    (editor: any, monaco: any) => {
      // Add keyboard shortcuts
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveFile();
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => {
        saveAllFiles();
      });
    },
    [saveFile, saveAllFiles]
  );

  // Close file tab
  const closeFile = useCallback(
    (filePath: string) => {
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });

      if (activeFilePath === filePath) {
        const remaining = Array.from(openFiles.keys()).filter((p) => p !== filePath);
        setActiveFilePath(remaining[0] || null);
      }
    },
    [activeFilePath, openFiles]
  );

  // Handle resize
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = explorerWidth;

      const handleMouseMove = (e: MouseEvent) => {
        const newWidth = Math.max(150, Math.min(600, startWidth + e.clientX - startX));
        setExplorerWidth(newWidth);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      // Set cursor and prevent text selection during resize
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [explorerWidth]
  );

  // Auto-save on changes
  useEffect(() => {
    if (!activeFile?.isDirty) return;

    const timer = setTimeout(() => {
      saveFile();
    }, 2000);

    return () => clearTimeout(timer);
  }, [activeFile?.content, activeFile?.isDirty, saveFile]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-background">
      {/* VS Code-like Header */}
      <div className="flex h-9 items-center justify-between border-b border-border bg-muted/30 px-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{taskName}</span>
          {hasUnsavedChanges && <span className="text-xs text-amber-500">● Unsaved changes</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => saveAllFiles()}
            disabled={!hasUnsavedChanges || isSaving}
            title="Save All (⌘⇧S)"
          >
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={toggleRightSidebar}
            title={rightSidebarCollapsed ? 'Show Changes' : 'Hide Changes'}
          >
            <PanelRight className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - File Explorer */}
        <div
          className="relative flex flex-col border-r border-border bg-muted/5"
          style={{ width: explorerWidth }}
        >
          {/* Explorer tabs (like VS Code) */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Tab buttons */}
            <div className="flex h-8 items-center border-b border-border px-2">
              <button className="border-b-2 border-primary px-2 py-1 text-xs font-medium">
                FILES
              </button>
              <button className="px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                SEARCH
              </button>
            </div>

            {/* Files tab content */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-2 py-1">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Explorer
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setShowHiddenFiles(!showHiddenFiles)}
                    title={showHiddenFiles ? 'Hide excluded files' : 'Show excluded files'}
                  >
                    {showHiddenFiles ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" title="Refresh">
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <FileTree
                rootPath={taskPath}
                selectedFile={selectedFile}
                onSelectFile={loadFile}
                onOpenFile={loadFile}
                className="flex-1 overflow-y-auto"
                showHiddenFiles={showHiddenFiles}
                excludePatterns={excludePatterns}
              />
            </div>
          </div>

          {/* Resize handle */}
          <div
            className={cn(
              'absolute -right-1 top-0 h-full w-2 cursor-col-resize',
              'hover:bg-blue-500/20 active:bg-blue-500/30',
              "after:absolute after:left-1/2 after:top-0 after:h-full after:w-0.5 after:-translate-x-1/2 after:content-['']",
              'after:bg-border hover:after:bg-blue-500/50',
              isResizing && 'bg-blue-500/30 after:bg-blue-500'
            )}
            onMouseDown={handleMouseDown}
            title="Drag to resize"
          />
        </div>

        {/* Editor area */}
        <div className="flex flex-1 flex-col">
          {/* Tabs for open files */}
          {openFiles.size > 0 && (
            <div className="flex h-8 items-center overflow-x-auto border-b border-border bg-muted/10">
              {Array.from(openFiles.entries()).map(([path, file]) => (
                <div
                  key={path}
                  className={cn(
                    'flex h-full cursor-pointer items-center gap-1.5 border-r border-border px-3 hover:bg-accent/50',
                    activeFilePath === path && 'bg-background'
                  )}
                  onClick={() => setActiveFilePath(path)}
                >
                  <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  <span className="text-xs">{path.split('/').pop()}</span>
                  {file.isDirty && <span className="text-amber-500">●</span>}
                  <button
                    className="ml-1 rounded p-0.5 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(path);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Monaco Editor */}
          {activeFile ? (
            <div className="flex-1">
              <Editor
                height="100%"
                language={getMonacoLanguageId(activeFile.path)}
                value={activeFile.content}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                theme={effectiveTheme === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  minimap: { enabled: true },
                  fontSize: 13,
                  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                  lineNumbers: 'on',
                  rulers: [80, 120],
                  wordWrap: 'on',
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  renderWhitespace: 'selection',
                  cursorBlinking: 'smooth',
                  smoothScrolling: true,
                  formatOnPaste: true,
                  formatOnType: true,
                }}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <div className="text-center">
                <p className="text-sm">No file open</p>
                <p className="mt-1 text-xs">Select a file from the explorer</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { X, FolderOpen, FileText, PanelRight, Save } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { getMonacoLanguageId } from '@/lib/diffUtils';
import { useTheme } from '@/hooks/useTheme';
import { useRightSidebar } from '../ui/right-sidebar';
import { FileTree } from './FileTree';

interface CodeEditorProps {
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

// Default exclude patterns
const DEFAULT_EXCLUDES = [
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

export default function CodeEditor({ taskPath, taskName, onClose }: CodeEditorProps) {
  const { effectiveTheme } = useTheme();
  const { toggle: toggleRightSidebar, collapsed: rightSidebarCollapsed } = useRightSidebar();

  // File management state
  const [openFiles, setOpenFiles] = useState<Map<string, OpenFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // UI state
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Always use default excludes - removed the toggle functionality
  const excludePatterns = useMemo(() => [...DEFAULT_EXCLUDES], []);

  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const hasUnsavedChanges = Array.from(openFiles.values()).some((f) => f.isDirty);

  // Component mount effect
  useEffect(() => {
    // Component mounted
  }, [taskPath, taskName]);

  // Check if file is an image
  const isImageFile = (filePath: string): boolean => {
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
    const ext = filePath.split('.').pop()?.toLowerCase();
    return ext ? imageExtensions.includes(ext) : false;
  };

  // Load file content
  const loadFile = useCallback(
    async (filePath: string) => {
      try {
        // For image files, load as base64 data URL
        if (isImageFile(filePath)) {
          const result = await window.electronAPI.fsReadImage(taskPath, filePath);

          if (result.success && result.dataUrl) {
            const openFile: OpenFile = {
              path: filePath,
              content: result.dataUrl, // Store the data URL
              originalContent: result.dataUrl,
              isDirty: false,
            };

            setOpenFiles((prev) => new Map(prev).set(filePath, openFile));
            setActiveFilePath(filePath);
            setSelectedFile(filePath);
          } else {
            console.error('Failed to load image:', result.error);
            // Show error in UI
            const openFile: OpenFile = {
              path: filePath,
              content: '[IMAGE_ERROR]',
              originalContent: '[IMAGE_ERROR]',
              isDirty: false,
            };
            setOpenFiles((prev) => new Map(prev).set(filePath, openFile));
            setActiveFilePath(filePath);
            setSelectedFile(filePath);
          }
          return;
        }

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

      <div className="flex flex-1 overflow-hidden">
        <div
          className="relative flex flex-col border-r border-border bg-muted/5"
          style={{ width: explorerWidth }}
        >
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex h-8 items-center border-b border-border px-2">
              <button className="border-b-2 border-primary px-2 py-1 text-xs font-medium">
                FILES
              </button>
              <button className="px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                SEARCH
              </button>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-2 py-1">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Explorer
                </span>
              </div>

              <FileTree
                rootPath={taskPath}
                selectedFile={selectedFile}
                onSelectFile={loadFile}
                onOpenFile={loadFile}
                className="flex-1 overflow-y-auto"
                showHiddenFiles={false}
                excludePatterns={excludePatterns}
              />
            </div>
          </div>

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

        <div className="flex flex-1 flex-col">
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

          {activeFile ? (
            activeFile.content.startsWith('data:image/') ? (
              // Image preview with base64 data URL - consistent sizing
              <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-8">
                <div className="flex flex-col items-center">
                  <div className="relative flex h-[400px] w-[600px] items-center justify-center rounded-lg border border-border bg-muted/20 p-4">
                    <img
                      src={activeFile.content}
                      alt={activeFile.path}
                      className="max-h-full max-w-full object-contain"
                      style={{ imageRendering: 'auto' }}
                    />
                  </div>
                  <div className="mt-4 text-center">
                    <div className="text-sm font-medium text-foreground">
                      {activeFile.path.split('/').pop()}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{activeFile.path}</div>
                  </div>
                </div>
              </div>
            ) : activeFile.content === '[IMAGE_ERROR]' ? (
              // Image loading error
              <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-8">
                <div className="text-center text-muted-foreground">
                  <p className="mb-2 text-sm">Failed to load image</p>
                  <p className="text-xs opacity-70">{activeFile.path}</p>
                  <p className="mt-2 text-xs opacity-50">The image file could not be read</p>
                </div>
              </div>
            ) : (
              // Text editor
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
            )
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

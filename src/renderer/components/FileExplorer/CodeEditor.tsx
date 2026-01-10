import React, { useState, useCallback, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { cn } from '@/lib/utils';
import { getMonacoLanguageId } from '@/lib/diffUtils';
import { useTheme } from '@/hooks/useTheme';
import { useRightSidebar } from '../ui/right-sidebar';
import { useFileManager } from '@/hooks/useFileManager';
import { useEditorDiffDecorations } from '@/hooks/useEditorDiffDecorations';
import {
  configureMonacoTypeScript,
  configureMonacoEditor,
  addMonacoKeyboardShortcuts,
} from '@/lib/monaco-config';
import {
  DEFAULT_EXCLUDE_PATTERNS,
  EXPLORER_WIDTH,
  DEFAULT_EDITOR_OPTIONS,
} from '@/constants/file-explorer';
import { FileTree } from './FileTree';
import { FileTabs } from './FileTabs';
import { EditorHeader } from './EditorHeader';
import '@/styles/editor-diff.css';

interface CodeEditorProps {
  taskPath: string;
  taskName: string;
  projectName: string;
  onClose: () => void;
}

export default function CodeEditor({ taskPath, taskName, projectName, onClose }: CodeEditorProps) {
  const { effectiveTheme } = useTheme();
  const { toggle: toggleRightSidebar, collapsed: rightSidebarCollapsed } = useRightSidebar();
  const monacoRef = useRef<any>(null);
  const editorRef = useRef<any>(null);

  // File management with custom hook
  const {
    openFiles,
    activeFilePath,
    activeFile,
    hasUnsavedChanges,
    isSaving,
    loadFile,
    saveFile,
    saveAllFiles,
    closeFile,
    updateFileContent,
    setActiveFile,
  } = useFileManager({ taskPath });

  // UI state
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_WIDTH.DEFAULT);
  const [isResizing, setIsResizing] = useState(false);

  // State to track when editor is ready
  const [editorReady, setEditorReady] = useState(false);

  // Diff decorations for showing git changes in the editor
  const { refreshDecorations } = useEditorDiffDecorations({
    editor: editorReady ? editorRef.current : null,
    filePath: activeFilePath || '',
    taskPath,
  });

  // Refresh diff decorations when active file changes or when file is saved
  useEffect(() => {
    if (editorReady && editorRef.current && activeFilePath && refreshDecorations) {
      // Small delay to ensure file content is loaded and git has updated
      const timer = setTimeout(() => {
        refreshDecorations();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [activeFilePath, editorReady, refreshDecorations, activeFile?.isDirty]);

  // Track previous save state to detect when a save completes
  const prevIsSaving = useRef(false);

  // Refresh decorations after save
  useEffect(() => {
    // Detect when save just completed (was saving, now not saving)
    if (prevIsSaving.current && !isSaving && editorReady && refreshDecorations) {
      // Immediately clear decorations to prevent old markers from showing
      if (editorRef.current) {
        // Clear existing decorations immediately
        refreshDecorations(true); // Invalidate cache and refresh immediately
      }

      // Then refresh again after git has updated
      const timer = setTimeout(() => {
        refreshDecorations(true); // true = invalidate cache to get fresh diff
      }, 800); // Wait for git to fully update

      prevIsSaving.current = false;
      return () => clearTimeout(timer);
    }

    prevIsSaving.current = isSaving;
  }, [isSaving, editorReady, refreshDecorations]);

  // Initialize Monaco once when first loaded
  useEffect(() => {
    const initMonaco = async () => {
      const { loader } = await import('@monaco-editor/react');
      loader.init().then((monaco) => {
        if (!monacoRef.current) {
          monacoRef.current = monaco;
          configureMonacoTypeScript(monaco);

          // Define custom themes with matching background colors
          monaco.editor.defineTheme('custom-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
              'editor.background': '#1e293b', // slate-800 - matches diff viewer
              'editor.foreground': '#e2e8f0',
              'editor.lineHighlightBackground': '#334155',
              'editorLineNumber.foreground': '#64748b',
              'editorGutter.background': '#1e293b',
            },
          });

          // Black theme with pure black background
          monaco.editor.defineTheme('custom-black', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
              'editor.background': '#000000', // pure black
              'editor.foreground': '#f2f2f2',
              'editor.lineHighlightBackground': '#1a1a1a',
              'editorLineNumber.foreground': '#666666',
              'editorGutter.background': '#000000',
            },
          });

          monaco.editor.defineTheme('custom-light', {
            base: 'vs',
            inherit: true,
            rules: [],
            colors: {
              'editor.background': '#f8fafc', // slate-50 - matches diff viewer
              'editor.foreground': '#1e293b',
              'editor.lineHighlightBackground': '#f1f5f9',
              'editorLineNumber.foreground': '#94a3b8',
              'editorGutter.background': '#f8fafc',
            },
          });
        }
      });
    };
    initMonaco();
  }, []);

  // Handle editor mount
  const handleEditorMount = useCallback(
    (editor: any, monaco: any) => {
      // Store editor reference
      editorRef.current = editor;

      // Configure Monaco if not already done
      if (!monacoRef.current) {
        monacoRef.current = monaco;
        configureMonacoTypeScript(monaco);
      }

      // Define custom themes with matching background colors
      monaco.editor.defineTheme('custom-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#1e293b', // slate-800 - matches diff viewer
          'editor.foreground': '#e2e8f0',
          'editor.lineHighlightBackground': '#334155',
          'editorLineNumber.foreground': '#64748b',
          'editorGutter.background': '#1e293b',
        },
      });

      // Black theme with pure black background
      monaco.editor.defineTheme('custom-black', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#000000', // pure black
          'editor.foreground': '#f2f2f2',
          'editor.lineHighlightBackground': '#1a1a1a',
          'editorLineNumber.foreground': '#666666',
          'editorGutter.background': '#000000',
        },
      });

      monaco.editor.defineTheme('custom-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#f8fafc', // slate-50 - matches diff viewer
          'editor.foreground': '#1e293b',
          'editor.lineHighlightBackground': '#f1f5f9',
          'editorLineNumber.foreground': '#94a3b8',
          'editorGutter.background': '#f8fafc',
        },
      });

      // Configure editor options
      configureMonacoEditor(editor, monaco);

      // Enable glyph margin for diff indicators
      editor.updateOptions({
        glyphMargin: true,
      });

      // Add keyboard shortcuts
      addMonacoKeyboardShortcuts(editor, monaco, {
        onSave: async () => {
          await saveFile();
          // Refresh decorations after save with cache invalidation
          setTimeout(() => {
            if (refreshDecorations) {
              refreshDecorations(true); // true = invalidate cache
            }
          }, 700); // Wait for git to update
        },
        onSaveAll: saveAllFiles,
      });

      // Mark editor as ready
      setEditorReady(true);

      // Refresh decorations when editor is ready
      setTimeout(() => {
        if (refreshDecorations) {
          refreshDecorations();
        }
      }, 100);
    },
    [saveFile, saveAllFiles, refreshDecorations]
  );

  // Handle editor content change
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeFilePath || value === undefined) return;
      updateFileContent(activeFilePath, value);
    },
    [activeFilePath, updateFileContent]
  );

  // Handle resize
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = explorerWidth;

      const handleMouseMove = (e: MouseEvent) => {
        const newWidth = Math.max(
          EXPLORER_WIDTH.MIN,
          Math.min(EXPLORER_WIDTH.MAX, startWidth + e.clientX - startX)
        );
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

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-background">
      <EditorHeader
        taskName={taskName}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isSaving}
        rightSidebarCollapsed={rightSidebarCollapsed}
        onSaveAll={saveAllFiles}
        onToggleRightSidebar={toggleRightSidebar}
        onClose={onClose}
      />

      <div className="flex flex-1 overflow-hidden">
        <FileExplorer
          taskPath={taskPath}
          taskName={taskName}
          projectName={projectName}
          explorerWidth={explorerWidth}
          isResizing={isResizing}
          selectedFile={activeFilePath}
          onSelectFile={loadFile}
          onOpenFile={loadFile}
          onMouseDown={handleMouseDown}
        />

        <div className="flex flex-1 flex-col">
          <FileTabs
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            onTabClick={setActiveFile}
            onTabClose={closeFile}
          />

          <EditorContent
            activeFile={activeFile}
            effectiveTheme={effectiveTheme}
            onEditorMount={handleEditorMount}
            onEditorChange={handleEditorChange}
          />
        </div>
      </div>
    </div>
  );
}

interface FileExplorerProps {
  taskPath: string;
  taskName: string;
  projectName: string;
  explorerWidth: number;
  isResizing: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onOpenFile: (path: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

const FileExplorer: React.FC<FileExplorerProps> = ({
  taskPath,
  taskName,
  projectName,
  explorerWidth,
  isResizing,
  selectedFile,
  onSelectFile,
  onOpenFile,
  onMouseDown,
}) => (
  <div
    className="relative flex flex-col border-r border-border bg-muted/5"
    style={{ width: explorerWidth }}
  >
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-8 items-center border-b border-border bg-muted/10 px-3">
        <span className="text-xs font-medium text-foreground">{projectName}</span>
      </div>
      <div className="flex h-8 items-center border-b border-border bg-muted/20 px-3">
        <span className="text-xs font-medium text-foreground">{taskName}</span>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <FileTree
          rootPath={taskPath}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          onOpenFile={onOpenFile}
          className="flex-1 overflow-y-auto"
          showHiddenFiles={false}
          excludePatterns={DEFAULT_EXCLUDE_PATTERNS}
        />
      </div>
    </div>

    <ResizeHandle isResizing={isResizing} onMouseDown={onMouseDown} />
  </div>
);

const ResizeHandle: React.FC<{
  isResizing: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}> = ({ isResizing, onMouseDown }) => (
  <div
    className={cn(
      'absolute -right-1 top-0 h-full w-2 cursor-col-resize',
      'transition-colors hover:bg-border/80',
      "after:absolute after:left-1/2 after:top-0 after:h-full after:w-0.5 after:-translate-x-1/2 after:content-['']",
      'after:bg-border',
      isResizing && 'bg-border/80'
    )}
    onMouseDown={onMouseDown}
    title="Drag to resize"
  />
);

interface EditorContentProps {
  activeFile: any;
  effectiveTheme: string;
  onEditorMount: (editor: any, monaco: any) => void;
  onEditorChange: (value: string | undefined) => void;
}

const EditorContent: React.FC<EditorContentProps> = ({
  activeFile,
  effectiveTheme,
  onEditorMount,
  onEditorChange,
}) => {
  if (!activeFile) {
    return <NoFileOpen />;
  }

  if (activeFile.content.startsWith('data:image/')) {
    return <ImagePreview file={activeFile} />;
  }

  if (activeFile.content === '[IMAGE_ERROR]') {
    return <ImageError file={activeFile} />;
  }

  return (
    <div className="flex-1">
      <Editor
        height="100%"
        language={getMonacoLanguageId(activeFile.path)}
        value={activeFile.content}
        onChange={onEditorChange}
        onMount={onEditorMount}
        theme={
          effectiveTheme === 'dark-black'
            ? 'custom-black'
            : effectiveTheme === 'dark'
              ? 'custom-dark'
              : 'custom-light'
        }
        options={DEFAULT_EDITOR_OPTIONS}
      />
    </div>
  );
};

const NoFileOpen: React.FC = () => (
  <div className="flex flex-1 items-center justify-center text-muted-foreground">
    <div className="text-center">
      {/** 
      <p className="text-sm">No file open</p>
      <p className="mt-1 text-xs">Select a file from the explorer</p>
      */}
    </div>
  </div>
);

const ImagePreview: React.FC<{ file: any }> = ({ file }) => (
  <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-8">
    <div className="flex flex-col items-center">
      <div className="relative flex h-[400px] w-[600px] items-center justify-center rounded-lg border border-border bg-muted/20 p-4">
        <img
          src={file.content}
          alt={file.path}
          className="max-h-full max-w-full object-contain"
          style={{ imageRendering: 'auto' }}
        />
      </div>
      <div className="mt-4 text-center">
        <div className="text-sm font-medium text-foreground">{file.path.split('/').pop()}</div>
        <div className="mt-1 text-xs text-muted-foreground">{file.path}</div>
      </div>
    </div>
  </div>
);

const ImageError: React.FC<{ file: any }> = ({ file }) => (
  <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-8">
    <div className="text-center text-muted-foreground">
      <p className="mb-2 text-sm">Failed to load image</p>
      <p className="text-xs opacity-70">{file.path}</p>
      <p className="mt-2 text-xs opacity-50">The image file could not be read</p>
    </div>
  </div>
);

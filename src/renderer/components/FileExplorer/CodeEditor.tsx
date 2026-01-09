import React, { useState, useCallback, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { cn } from '@/lib/utils';
import { getMonacoLanguageId } from '@/lib/diffUtils';
import { useTheme } from '@/hooks/useTheme';
import { useRightSidebar } from '../ui/right-sidebar';
import { useFileManager } from '@/hooks/useFileManager';
import {
  configureMonacoTypeScript,
  configureMonacoEditor,
  addMonacoKeyboardShortcuts,
} from '@/lib/monaco-config';
import {
  DEFAULT_EXCLUDE_PATTERNS,
  EXPLORER_WIDTH,
  EDITOR_THEMES,
  DEFAULT_EDITOR_OPTIONS,
} from '@/constants/file-explorer';
import { FileTree } from './FileTree';
import { FileTabs } from './FileTabs';
import { EditorHeader } from './EditorHeader';
import { FolderOpen, GitBranch } from 'lucide-react';

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

  // Initialize Monaco once when first loaded
  useEffect(() => {
    const initMonaco = async () => {
      const { loader } = await import('@monaco-editor/react');
      loader.init().then((monaco) => {
        if (!monacoRef.current) {
          monacoRef.current = monaco;
          configureMonacoTypeScript(monaco);
        }
      });
    };
    initMonaco();
  }, []);

  // Handle editor mount
  const handleEditorMount = useCallback(
    (editor: any, monaco: any) => {
      // Configure Monaco if not already done
      if (!monacoRef.current) {
        monacoRef.current = monaco;
        configureMonacoTypeScript(monaco);
      }

      // Configure editor options
      configureMonacoEditor(editor, monaco);

      // Add keyboard shortcuts
      addMonacoKeyboardShortcuts(editor, monaco, {
        onSave: saveFile,
        onSaveAll: saveAllFiles,
      });
    },
    [saveFile, saveAllFiles]
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
        <FolderOpen className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">{projectName}</span>
        <span className="mx-1.5 text-muted-foreground">/</span>
        <GitBranch className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
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
      'hover:bg-blue-500/20 active:bg-blue-500/30',
      "after:absolute after:left-1/2 after:top-0 after:h-full after:w-0.5 after:-translate-x-1/2 after:content-['']",
      'after:bg-border hover:after:bg-blue-500/50',
      isResizing && 'bg-blue-500/30 after:bg-blue-500'
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
        theme={effectiveTheme === 'dark' ? EDITOR_THEMES.DARK : EDITOR_THEMES.LIGHT}
        options={DEFAULT_EDITOR_OPTIONS}
      />
    </div>
  );
};

const NoFileOpen: React.FC = () => (
  <div className="flex flex-1 items-center justify-center text-muted-foreground">
    <div className="text-center">
      <p className="text-sm">No file open</p>
      <p className="mt-1 text-xs">Select a file from the explorer</p>
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

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useCurrentTask } from './CurrentTaskProvider';
import { useCurrentProject } from './CurrentProjectProvider';
import { useProjectRemoteInfo } from '@renderer/hooks/useProjectRemoteInfo';
import { useFileManager, type ManagedFile } from '@renderer/hooks/useFileManager';
import { useFileChanges, type FileChange } from '@renderer/hooks/useFileChanges';
import { isMarkdownFile } from '@renderer/constants/file-explorer';

interface CodeEditorContextValue {
  // Task/project info
  taskId: string;
  taskPath: string;
  taskName: string;
  projectName: string;
  connectionId: string | null;
  remotePath: string | null;

  // File manager state
  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  activeFile: ManagedFile | null;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  loadFile: (filePath: string) => Promise<void>;
  saveFile: (filePath?: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  closeFile: (filePath: string) => void;
  updateFileContent: (filePath: string, content: string) => void;
  setActiveFile: (filePath: string | null) => void;

  // Git file change status
  fileChanges: FileChange[];

  // Preview mode (markdown files default to preview)
  previewMode: Map<string, boolean>;
  togglePreview: (filePath: string) => void;
  handleCloseFile: (filePath: string) => void;
}

const CodeEditorContext = createContext<CodeEditorContextValue | null>(null);

export function useCodeEditorContext(): CodeEditorContextValue {
  const context = useContext(CodeEditorContext);
  if (!context) {
    throw new Error('useCodeEditorContext must be used within a CodeEditorProvider');
  }
  return context;
}

function CodeEditorActiveProvider({
  children,
  taskId,
  taskPath,
  taskName,
  projectName,
  connectionId,
  remotePath,
}: {
  children: ReactNode;
  taskId: string;
  taskPath: string;
  taskName: string;
  projectName: string;
  connectionId: string | null;
  remotePath: string | null;
}) {
  const fileManager = useFileManager({ taskId, taskPath, connectionId, remotePath });
  const { fileChanges } = useFileChanges(taskPath);
  const [previewMode, setPreviewMode] = useState<Map<string, boolean>>(new Map());

  const togglePreview = useCallback((filePath: string) => {
    setPreviewMode((prev) => {
      const next = new Map(prev);
      const current = next.get(filePath) ?? isMarkdownFile(filePath);
      next.set(filePath, !current);
      return next;
    });
  }, []);

  const handleCloseFile = useCallback(
    (filePath: string) => {
      fileManager.closeFile(filePath);
      setPreviewMode((prev) => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
    },
    [fileManager]
  );

  const value: CodeEditorContextValue = {
    taskId,
    taskPath,
    taskName,
    projectName,
    connectionId,
    remotePath,
    ...fileManager,
    fileChanges,
    previewMode,
    togglePreview,
    handleCloseFile,
  };

  return <CodeEditorContext.Provider value={value}>{children}</CodeEditorContext.Provider>;
}

export function CodeEditorProvider({ children }: { children: ReactNode }) {
  const task = useCurrentTask();
  const project = useCurrentProject();
  const { connectionId, remotePath } = useProjectRemoteInfo(project);

  if (!task || !project) {
    return <>{children}</>;
  }

  return (
    <CodeEditorActiveProvider
      taskId={task.id}
      taskPath={task.path}
      taskName={task.name}
      projectName={project.name}
      connectionId={connectionId}
      remotePath={remotePath}
    >
      {children}
    </CodeEditorActiveProvider>
  );
}

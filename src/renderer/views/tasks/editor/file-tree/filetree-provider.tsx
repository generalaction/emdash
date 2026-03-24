import { observer } from 'mobx-react-lite';
import React, { createContext, useContext } from 'react';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { useFileTree, UseFileTreeResult } from './use-file-tree';

type FileTreeContextValue = UseFileTreeResult;

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export const EditorFiletreeProvider = observer(function EditorFiletreeProvider({
  children,
  projectId,
  taskId,
}: {
  children: React.ReactNode;
  projectId: string;
  taskId: string;
}) {
  const { lifecycleTask } = useTaskViewContext();
  const isReady = lifecycleTask.status === 'ready';

  const filetree = useFileTree(projectId, taskId, isReady);

  return <FileTreeContext.Provider value={filetree}>{children}</FileTreeContext.Provider>;
});

export function useFileTreeContext(): FileTreeContextValue {
  const context = useContext(FileTreeContext);
  if (!context) {
    throw new Error('useFileTreeContext must be used within a FileTreeProvider');
  }
  return context;
}

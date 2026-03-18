import React, { createContext, useContext } from 'react';
import type { FileNode } from '@shared/fs';
import { useTaskViewContext } from '../task-view-context';
import { useFileTree, type UseFileTreeResult } from './use-file-tree';

export interface EditorFiletreeContextValue {
  visibleRows: FileNode[];
  expandedPaths: Set<string>;
  loadedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  revealFile: (filePath: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const EditorFiletreeContext = createContext<EditorFiletreeContextValue | null>(null);

export function EditorFiletreeProvider({ children }: { children: React.ReactNode }) {
  const { projectId, taskId } = useTaskViewContext();
  const filetree: UseFileTreeResult = useFileTree(projectId, taskId);

  return (
    <EditorFiletreeContext.Provider value={filetree}>{children}</EditorFiletreeContext.Provider>
  );
}

export function useEditorFiletreeContext(): EditorFiletreeContextValue {
  const context = useContext(EditorFiletreeContext);
  if (!context) {
    throw new Error('useEditorFiletreeContext must be used within a EditorFiletreeProvider');
  }
  return context;
}

import { createContext, useContext } from 'react';

interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
}

interface EditorFiletreeContextValue {}

const EditorFiletreeContext = createContext<EditorFiletreeContextValue | null>(null);

export function EditorFiletreeProvider({ children }: { children: React.ReactNode }) {
  return <EditorFiletreeContext.Provider value={{}}>{children}</EditorFiletreeContext.Provider>;
}

export function useEditorFiletreeContext(): EditorFiletreeContextValue {
  const context = useContext(EditorFiletreeContext);
  if (!context) {
    throw new Error('useEditorFiletreeContext must be used within a EditorFiletreeProvider');
  }
  return context;
}

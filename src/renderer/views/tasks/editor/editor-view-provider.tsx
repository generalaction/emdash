import { createContext, useContext } from 'react';

interface EditorViewContextValue {}

const EditorViewContext = createContext<EditorViewContextValue | null>(null);

export function EditorViewProvider({ children }: { children: React.ReactNode }) {
  return <EditorViewContext.Provider value={{}}>{children}</EditorViewContext.Provider>;
}

export function useEditorViewContext(): EditorViewContextValue {
  const context = useContext(EditorViewContext);
  if (!context) {
    throw new Error('useEditorViewContext must be used within a EditorViewProvider');
  }
  return context;
}

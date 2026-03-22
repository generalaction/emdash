import { createContext, useCallback, useContext, useState } from 'react';
import { isMarkdownFile } from '@renderer/core/editor/utils';

interface EditorViewContextValue {
  /** Whether a given file is shown in preview mode (markdown preview, etc.). */
  previewMode: Map<string, boolean>;
  togglePreview: (filePath: string) => void;
  clearPreviewMode: (filePath: string) => void;
}

const EditorViewContext = createContext<EditorViewContextValue | null>(null);

export function EditorViewProvider({ children }: { children: React.ReactNode }) {
  const [previewMode, setPreviewMode] = useState<Map<string, boolean>>(new Map());

  const togglePreview = useCallback((filePath: string) => {
    setPreviewMode((prev) => {
      const next = new Map(prev);
      const current = next.get(filePath) ?? isMarkdownFile(filePath);
      next.set(filePath, !current);
      return next;
    });
  }, []);

  const clearPreviewMode = useCallback((filePath: string) => {
    setPreviewMode((prev) => {
      if (!prev.has(filePath)) return prev;
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  return (
    <EditorViewContext.Provider value={{ previewMode, togglePreview, clearPreviewMode }}>
      {children}
    </EditorViewContext.Provider>
  );
}

export function useEditorViewContext(): EditorViewContextValue {
  const context = useContext(EditorViewContext);
  if (!context) {
    throw new Error('useEditorViewContext must be used within a EditorViewProvider');
  }
  return context;
}

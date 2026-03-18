import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

export interface ActiveFile {
  path: string;
  isStaged: boolean;
  /** Controls virtualizer scroll animation when this file becomes active. Defaults to 'smooth'. */
  scrollBehavior?: 'smooth' | 'auto';
}

interface GitViewContextValue {
  activeTab: 'changes' | 'history';
  setActiveTab: (tab: 'changes' | 'history') => void;
  diffStyle: 'unified' | 'split';
  setDiffStyle: (style: 'unified' | 'split') => void;
  viewMode: 'stacked' | 'file';
  setViewMode: (mode: 'stacked' | 'file') => void;
  activeFile: ActiveFile | null;
  setActiveFile: (file: ActiveFile | null) => void;
}

const GitViewContext = createContext<GitViewContextValue | null>(null);

export function GitViewProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<'changes' | 'history'>('changes');
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>(
    () => (localStorage.getItem('diffViewer:diffStyle') as 'unified' | 'split') || 'unified'
  );
  const [viewMode, setViewMode] = useState<'stacked' | 'file'>(
    () => (localStorage.getItem('diffViewer:viewMode') as 'stacked' | 'file') || 'stacked'
  );
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);

  const setDiffStylePersisted = useCallback((style: 'unified' | 'split') => {
    setDiffStyle(style);
    localStorage.setItem('diffViewer:diffStyle', style);
  }, []);

  const setViewModePersisted = useCallback(
    (mode: 'stacked' | 'file') => {
      setViewMode(mode);
      localStorage.setItem('diffViewer:viewMode', mode);
    },
    [setViewMode]
  );

  return (
    <GitViewContext.Provider
      value={{
        activeTab,
        setActiveTab,
        diffStyle,
        setDiffStyle: setDiffStylePersisted,
        viewMode,
        setViewMode: setViewModePersisted,
        activeFile,
        setActiveFile,
      }}
    >
      {children}
    </GitViewContext.Provider>
  );
}

export function useGitViewContext() {
  const context = useContext(GitViewContext);
  if (!context) {
    throw new Error('useGitViewContext must be used within a GitViewProvider');
  }
  return context;
}

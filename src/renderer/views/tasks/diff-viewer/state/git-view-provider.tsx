import { createContext, ReactNode, useContext, useState } from 'react';

export type Stage = 'unstaged' | 'staged' | 'pr';

export interface ActiveFile {
  path: string;
  stage: Stage;
  scrollBehavior?: 'smooth' | 'auto';
}

interface GitViewContextValue {
  diffStyle: 'unified' | 'split';
  setDiffStyle: (style: 'unified' | 'split') => void;
  viewMode: 'stacked' | 'file';
  setViewMode: (mode: 'stacked' | 'file') => void;
  activeFile: ActiveFile | null;
  setActiveFile: (file: ActiveFile | null) => void;
}

const GitViewContext = createContext<GitViewContextValue | null>(null);

export function GitViewProvider({ children }: { children: ReactNode }) {
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const [viewMode, setViewMode] = useState<'stacked' | 'file'>('stacked');
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);

  return (
    <GitViewContext.Provider
      value={{
        diffStyle,
        setDiffStyle,
        viewMode,
        setViewMode,
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

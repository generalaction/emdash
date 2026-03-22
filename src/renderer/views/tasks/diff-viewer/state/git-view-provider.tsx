import { createContext, ReactNode, useContext, useState } from 'react';

export interface ActiveFile {
  path: string;
  /**
   * Which model types to use for the diff:
   *   'disk'   — right side = disk:// (working tree); left = git at originalRef
   *   'staged' — right side = git://'staged' (index content); left = git://HEAD
   *   'git'    — right side = git://HEAD; left = git at originalRef (PR / ref diffs)
   */
  type: 'disk' | 'staged' | 'git';
  /** Git ref for the left (original/before) side. For 'staged', always 'HEAD'. */
  originalRef: string;
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

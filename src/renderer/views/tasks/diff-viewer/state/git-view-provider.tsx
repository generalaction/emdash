import { createContext, ReactNode, useContext, useState } from 'react';

interface GitViewContextValue {
  activeTab: 'changes' | 'history';
  setActiveTab: (tab: 'changes' | 'history') => void;
  diffStyle: 'unified' | 'split';
  setDiffStyle: (style: 'unified' | 'split') => void;
  viewMode: 'stacked' | 'file';
  setViewMode: (mode: 'stacked' | 'file') => void;
}
const GitViewContext = createContext<GitViewContextValue | null>(null);

export function GitViewProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<'changes' | 'history'>('changes');
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const [viewMode, setViewMode] = useState<'stacked' | 'file'>('stacked');
  const [focusedFile, setFocusedFile] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <GitViewContext.Provider
      value={{ activeTab, setActiveTab, diffStyle, setDiffStyle, viewMode, setViewMode }}
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

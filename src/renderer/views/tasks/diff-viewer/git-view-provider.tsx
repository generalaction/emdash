import { createContext, ReactNode, useContext, useState } from 'react';

interface GitViewContextValue {
  activeTab: 'changes' | 'history';
  setActiveTab: (tab: 'changes' | 'history') => void;
}
const GitViewContext = createContext<GitViewContextValue | null>(null);

export function GitViewProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<'changes' | 'history'>('changes');

  return (
    <GitViewContext.Provider value={{ activeTab, setActiveTab }}>
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

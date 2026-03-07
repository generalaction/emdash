import React, { createContext, useContext, useState } from 'react';

type RightSidebarTab = 'git' | 'terminals';

interface RightSidebarViewContextValue {
  activeTab: RightSidebarTab;
  setActiveTab: (tab: RightSidebarTab) => void;
}

const RightSidebarViewContext = createContext<RightSidebarViewContextValue | null>(null);

export const RightSidebarViewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<RightSidebarTab>('git');

  return (
    <RightSidebarViewContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </RightSidebarViewContext.Provider>
  );
};

export function useRightSidebarView(): RightSidebarViewContextValue {
  const ctx = useContext(RightSidebarViewContext);
  if (!ctx) {
    throw new Error('useRightSidebarView must be used within RightSidebarViewProvider');
  }
  return ctx;
}

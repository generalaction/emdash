import * as React from 'react';

interface RightSidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (next: boolean) => void;
}

const RightSidebarContext = React.createContext<RightSidebarContextValue | undefined>(undefined);

export interface RightSidebarProviderProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export function RightSidebarProvider({
  children,
  defaultCollapsed = false,
}: RightSidebarProviderProps) {
  const [collapsed, setCollapsedState] = React.useState<boolean>(defaultCollapsed);

  const setCollapsed = React.useCallback((next: boolean) => {
    setCollapsedState(next);
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsedState((prev) => !prev);
  }, []);

  const value = React.useMemo<RightSidebarContextValue>(
    () => ({ collapsed, toggle, setCollapsed }),
    [collapsed, toggle, setCollapsed]
  );

  return <RightSidebarContext.Provider value={value}>{children}</RightSidebarContext.Provider>;
}

export function useRightSidebar() {
  const context = React.useContext(RightSidebarContext);
  if (!context) {
    throw new Error('useRightSidebar must be used within a RightSidebarProvider');
  }
  return context;
}

import * as React from 'react';

interface RightSidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (next: boolean) => void;
  changesVisible: boolean;
  terminalVisible: boolean;
  toggleChanges: () => void;
  toggleTerminal: () => void;
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
  const [changesVisible, setChangesVisible] = React.useState<boolean>(true);
  const [terminalVisible, setTerminalVisible] = React.useState<boolean>(true);

  const setCollapsed = React.useCallback((next: boolean) => {
    setCollapsedState(next);
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsedState((prev) => !prev);
  }, []);

  const toggleChanges = React.useCallback(() => {
    setChangesVisible((prev) => {
      if (prev && !terminalVisible) return prev;
      return !prev;
    });
  }, [terminalVisible]);

  const toggleTerminal = React.useCallback(() => {
    setTerminalVisible((prev) => {
      if (prev && !changesVisible) return prev;
      return !prev;
    });
  }, [changesVisible]);

  const value = React.useMemo<RightSidebarContextValue>(
    () => ({
      collapsed,
      toggle,
      setCollapsed,
      changesVisible,
      terminalVisible,
      toggleChanges,
      toggleTerminal,
    }),
    [
      collapsed,
      toggle,
      setCollapsed,
      changesVisible,
      terminalVisible,
      toggleChanges,
      toggleTerminal,
    ]
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

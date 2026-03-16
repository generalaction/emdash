import React, { createContext, useCallback, useContext } from 'react';
import { useNavigationHistory } from '../hooks/useNavigationHistory';
import { useTaskManagementContext } from './TaskManagementContext';

type NavigationHistoryContextValue = ReturnType<typeof useNavigationHistory>;

const NavigationHistoryContext = createContext<NavigationHistoryContextValue | null>(null);

export function useNavigationHistoryContext(): NavigationHistoryContextValue {
  const ctx = useContext(NavigationHistoryContext);
  if (!ctx) {
    throw new Error('useNavigationHistoryContext must be used within a NavigationHistoryProvider');
  }
  return ctx;
}

export function NavigationHistoryProvider({ children }: { children: React.ReactNode }) {
  const { allTasks } = useTaskManagementContext();

  const taskLookup = useCallback(
    (taskId: string) => allTasks.find((t) => t.task.id === taskId)?.task,
    [allTasks]
  );

  const navHistory = useNavigationHistory(taskLookup);

  return (
    <NavigationHistoryContext.Provider value={navHistory}>
      {children}
    </NavigationHistoryContext.Provider>
  );
}

import React, { createContext, useCallback, useContext } from 'react';
import { useNavigationHistory } from '../hooks/useNavigationHistory';
import { useTaskManagementContext } from './TaskManagementContext';

type NavigationHistoryContextValue = ReturnType<typeof useNavigationHistory>;

const NavigationHistoryContext = createContext<NavigationHistoryContextValue | null>(null);

/** Access the navigation history context (goBack, goForward, canGoBack, canGoForward). */
export function useNavigationHistoryContext(): NavigationHistoryContextValue {
  const ctx = useContext(NavigationHistoryContext);
  if (!ctx) {
    throw new Error('useNavigationHistoryContext must be used within a NavigationHistoryProvider');
  }
  return ctx;
}

/** Provides navigation history to the component tree, wiring up task lookup from TaskManagementContext. */
export function NavigationHistoryProvider({ children }: { children: React.ReactNode }) {
  const { allTasks } = useTaskManagementContext();

  /** Find a Task object by ID across all projects for history restoration. */
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

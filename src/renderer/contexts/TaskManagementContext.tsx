import { createContext, useContext } from 'react';
import type { useTaskManagement } from '../hooks/useTaskManagement';

type TaskManagementContextValue = ReturnType<typeof useTaskManagement>;

export const TaskManagementContext = createContext<TaskManagementContextValue | null>(null);

export function useTaskManagementContext(): TaskManagementContextValue {
  const ctx = useContext(TaskManagementContext);
  if (!ctx) {
    throw new Error(
      'useTaskManagementContext must be used within a TaskManagementContext.Provider'
    );
  }
  return ctx;
}

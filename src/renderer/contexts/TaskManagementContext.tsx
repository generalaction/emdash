import React, { createContext, useContext } from 'react';
import { useTaskManagement } from '../hooks/useTaskManagement';

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

export function TaskManagementProvider({ children }: { children: React.ReactNode }) {
  const taskManagement = useTaskManagement();
  return (
    <TaskManagementContext.Provider value={taskManagement}>
      {children}
    </TaskManagementContext.Provider>
  );
}

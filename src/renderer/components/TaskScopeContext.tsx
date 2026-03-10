import React, { createContext, useContext } from 'react';

export type TaskScope = {
  taskId?: string;
  taskPath?: string;
  projectPath?: string | null;
  prNumber?: number;
};

const TaskScopeContext = createContext<TaskScope | null>(null);

export const TaskScopeProvider: React.FC<{
  value: TaskScope;
  children: React.ReactNode;
}> = ({ value, children }) => {
  return <TaskScopeContext.Provider value={value}>{children}</TaskScopeContext.Provider>;
};

export function useTaskScope(): TaskScope {
  return useContext(TaskScopeContext) ?? {};
}

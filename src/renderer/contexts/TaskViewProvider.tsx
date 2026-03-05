import { createContext, ReactNode, useContext, useState } from 'react';

type TaskViewContext = {
  view: 'agents' | 'editor';
  setView: (view: 'agents' | 'editor') => void;
};

const TaskViewContext = createContext<TaskViewContext | null>(null);

export function TaskViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<'agents' | 'editor'>('agents');
  return <TaskViewContext.Provider value={{ view, setView }}>{children}</TaskViewContext.Provider>;
}

export function useTaskViewContext() {
  const context = useContext(TaskViewContext);
  if (!context) {
    throw new Error('useTaskViewContext must be used within a TaskViewProvider');
  }
  return context;
}

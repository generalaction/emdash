import { createContext, useContext, type ReactNode } from 'react';
import type { Task } from '../types/app';
import { CodeEditorProvider } from './CodeEditorProvider';
import { ProjectViewWrapper } from './CurrentProjectProvider';
import { useTaskManagementContext } from './TaskManagementProvider';
import { TaskViewProvider } from './TaskViewProvider';

const CurrentTaskContext = createContext<Task | null>(null);

export function useCurrentTask(): Task | null {
  return useContext(CurrentTaskContext);
}

export function useRequiredCurrentTask(): Task {
  const task = useContext(CurrentTaskContext);
  if (!task) {
    throw new Error('useRequiredCurrentTask must be used within a TaskViewWrapper');
  }
  return task;
}

interface CurrentTaskProviderProps {
  children: ReactNode;
  projectId: string;
  taskId: string;
}

function CurrentTaskProvider({ children, projectId, taskId }: CurrentTaskProviderProps) {
  const { tasksByProjectId } = useTaskManagementContext();
  const task = tasksByProjectId[projectId]?.find((t) => t.id === taskId) ?? null;
  return <CurrentTaskContext.Provider value={task}>{children}</CurrentTaskContext.Provider>;
}

interface TaskViewWrapperProps {
  children: ReactNode;
  projectId: string;
  taskId: string;
}

export function TaskViewWrapper({ children, projectId, taskId }: TaskViewWrapperProps) {
  return (
    <ProjectViewWrapper projectId={projectId}>
      <CurrentTaskProvider projectId={projectId} taskId={taskId}>
        <TaskViewProvider>
          <CodeEditorProvider>{children}</CodeEditorProvider>
        </TaskViewProvider>
      </CurrentTaskProvider>
    </ProjectViewWrapper>
  );
}

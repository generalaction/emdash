import { observer } from 'mobx-react-lite';
import { createContext, ReactNode, useContext } from 'react';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { useProjectSettings } from '@renderer/components/project-settings-modal/use-project-settings';
import { ViewLayoutOverrideContext } from '@renderer/core/view/navigation-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';
import { getTaskStore, taskViewKind } from './task-view-state';

interface TaskViewContext {
  projectId: string;
  taskId: string;
  projectSettings?: ProjectSettings;
}

const TaskViewContext = createContext<TaskViewContext | null>(null);

export const TaskViewWrapper = observer(function TaskViewWrapper({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  const { settings: projectSettings } = useProjectSettings(projectId);
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);
  const hideRightPanel = kind !== 'ready';

  return (
    <ViewLayoutOverrideContext.Provider value={{ hideRightPanel }}>
      <ProjectViewWrapper projectId={projectId}>
        <TaskViewContext.Provider value={{ projectId, taskId, projectSettings }}>
          {children}
        </TaskViewContext.Provider>
      </ProjectViewWrapper>
    </ViewLayoutOverrideContext.Provider>
  );
});

export function useTaskViewContext(): TaskViewContext {
  const context = useContext(TaskViewContext);
  if (!context) {
    throw new Error('useTaskViewContext must be used within a TaskViewContextProvider');
  }
  return context;
}

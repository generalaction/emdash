import { observer } from 'mobx-react-lite';
import { createContext, ReactNode, useContext } from 'react';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { useProjectSettings } from '@renderer/components/projects/use-project-settings';
import { type ProvisionedTask } from '@renderer/core/stores/task';
import {
  asProvisioned,
  getTaskStore,
  taskViewKind,
  type TaskViewKind,
} from '@renderer/core/stores/task-selectors';
import { ViewLayoutOverrideContext } from '@renderer/core/view/navigation-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';

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

export function useTaskViewKind(): TaskViewKind {
  const { projectId, taskId } = useTaskViewContext();
  return taskViewKind(getTaskStore(projectId, taskId), projectId);
}

/** Returns the provisioned task if ready, otherwise null. Safe to call at any task view state. */
export function useProvisionedTask(): ProvisionedTask | null {
  const { projectId, taskId } = useTaskViewContext();
  return asProvisioned(getTaskStore(projectId, taskId)) ?? null;
}

/**
 * Returns the provisioned task, throwing if the task is not yet provisioned.
 * Only call this inside components that are guarded by `kind !== 'ready'`.
 */
export function useRequireProvisionedTask(): ProvisionedTask {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) {
    throw new Error(
      `useRequireProvisionedTask: task "${taskId}" is not provisioned. ` +
        `This component must only render inside a provisioned task guard (kind !== 'ready').`
    );
  }
  return provisioned;
}

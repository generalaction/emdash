import { observer } from 'mobx-react-lite';
import { createContext, ReactNode, useContext } from 'react';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { useProjectSettings } from '@renderer/features/projects/use-project-settings';
import { ProjectViewWrapper } from '@renderer/features/projects/view/project-view-wrapper';
import { type ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskStore,
  taskViewKind,
  type TaskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { ViewLayoutOverrideContext } from '@renderer/lib/layout/navigation-provider';

const ProvisionedTaskContext = createContext<ProvisionedTask | null>(null);

export const ProvisionedTaskProvider = observer(function ProvisionedTaskProvider({
  projectId,
  taskId,
  children,
}: {
  projectId: string;
  taskId: string;
  children: ReactNode;
}) {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return null;
  return (
    <ProvisionedTaskContext.Provider value={provisioned}>
      {children}
    </ProvisionedTaskContext.Provider>
  );
});

/** Non-nullable. Only call inside a ProvisionedTaskProvider subtree (kind === 'ready'). */
export function useProvisionedTask(): ProvisionedTask {
  const ctx = useContext(ProvisionedTaskContext);
  if (!ctx) {
    throw new Error(
      'useProvisionedTask must be used inside ProvisionedTaskProvider (kind === "ready")'
    );
  }
  return ctx;
}

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

import { observer } from 'mobx-react-lite';
import { createContext, ReactNode, useCallback, useContext } from 'react';
import type {
  Conversation,
  CreateConversationParams,
  RenameConversationParams,
} from '@shared/conversations';
import type { Terminal } from '@shared/terminals';
import { ProjectSettings } from '@main/core/projects/settings/schema';
import { useProjectSettings } from '@renderer/components/project-settings-modal/use-project-settings';
import { useConversations } from '@renderer/core/conversations/use-conversations';
import { LifecycleTask, useTask } from '@renderer/core/tasks/task-lifecycle-provider';
import {
  taskViewStateStore,
  type MainPanelView,
  type RightPanelView,
} from '@renderer/core/tasks/view/task-view-store';
import { ViewLayoutOverrideContext } from '@renderer/core/view/navigation-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';
import { LifecycleScriptType, TerminalTabItem, useTerminals } from './hooks/use-terminals';

interface TaskViewContext {
  projectId: string;
  taskId: string;
  lifecycleTask: LifecycleTask;
  view: MainPanelView;
  setView: (view: MainPanelView) => void;
  rightPanelView: RightPanelView;
  setRightPanelView: (view: RightPanelView) => void;
  activeTerminalId?: string;
  setActiveTerminalId: (terminalId: string | undefined) => void;
  terminalTabItems: TerminalTabItem[];
  createTerminal: () => Promise<Terminal>;
  removeTerminal: (terminalId: string) => void;
  activeConversationId?: string;
  setActiveConversationId: (conversationId: string) => void;
  conversations: Conversation[];
  createConversation: (
    params: Omit<CreateConversationParams, 'projectId' | 'taskId'>
  ) => Promise<Conversation>;
  removeConversation: (conversationId: string) => void;
  renameConversation: (params: RenameConversationParams) => void;
  projectSettings?: ProjectSettings;
  runLifecycleScript: (type: LifecycleScriptType) => Promise<void>;
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
  const taskState = taskViewStateStore.getOrCreate(taskId);
  const lifecycleTask = useTask({ projectId, taskId });

  const { conversations, createConversation, removeConversation, renameConversation } =
    useConversations({
      projectId,
      taskId,
    });

  const { settings: projectSettings } = useProjectSettings(projectId);

  const { terminalTabItems, createTerminal, removeTerminal, runLifecycleScript } = useTerminals({
    projectId,
    taskId,
    projectSettings,
  });

  // taskState is a stable object reference for a given taskId —
  // these callbacks remain stable across renders.
  const setView = useCallback((v: MainPanelView) => taskState.setView(v), [taskState]);

  const setActiveConversationId = useCallback(
    (id: string) => {
      taskState.agentsView.setActiveConversationId(id);
      taskState.setRightPanelView('changes');
    },
    [taskState]
  );

  const setActiveTerminalId = useCallback(
    (id: string | undefined) => taskState.terminalsView.setActiveTerminalId(id),
    [taskState]
  );

  const setRightPanelView = useCallback(
    (v: RightPanelView) => taskState.setRightPanelView(v),
    [taskState]
  );

  const s = lifecycleTask.status;
  const hideRightPanel =
    s === 'creating' || s === 'create-error' || s === 'provisioning' || s === 'provision-error';

  return (
    <ViewLayoutOverrideContext.Provider value={{ hideRightPanel }}>
      <ProjectViewWrapper projectId={projectId}>
        <TaskViewContext.Provider
          value={{
            lifecycleTask,
            view: taskState.view,
            setView,
            projectId,
            taskId,
            activeConversationId: taskState.agentsView.activeConversationId,
            setActiveConversationId,
            activeTerminalId: taskState.terminalsView.activeTerminalId,
            setActiveTerminalId,
            rightPanelView: taskState.rightPanelView,
            setRightPanelView,
            conversations,
            createConversation,
            removeConversation,
            renameConversation,
            terminalTabItems,
            createTerminal,
            removeTerminal,
            runLifecycleScript,
            projectSettings,
          }}
        >
          {children}
        </TaskViewContext.Provider>
      </ProjectViewWrapper>
    </ViewLayoutOverrideContext.Provider>
  );
});

export function useTaskViewContext() {
  const context = useContext(TaskViewContext);
  if (!context) {
    throw new Error('useTaskViewContext must be used within a TaskViewContextProvider');
  }
  return context;
}

/** Asserts the task is fully provisioned and ready. */
export function useReadyTaskViewContext(): TaskViewContext & {
  lifecycleTask: Extract<LifecycleTask, { status: 'ready' }>;
} {
  const context = useTaskViewContext();
  if (context.lifecycleTask.status !== 'ready') {
    throw new Error('useReadyTaskViewContext must be used within a ready task');
  }
  return context as TaskViewContext & {
    lifecycleTask: Extract<LifecycleTask, { status: 'ready' }>;
  };
}

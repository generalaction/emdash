import { createContext, ReactNode, useCallback, useContext, useEffect } from 'react';
import type { Conversation, CreateConversationParams } from '@shared/conversations';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import { ProjectSettings } from '@main/core/projects/settings/schema';
import { useProjectSettings } from '@renderer/components/project-settings-modal/use-project-settings';
import { useConversations } from '@renderer/core/conversations/use-conversations';
import { useTaskBootstrapContext } from '@renderer/core/tasks/task-bootstrap-provider';
import { useTaskViewState } from '@renderer/core/tasks/task-view-state-provider';
import { ViewLayoutOverrideContext } from '@renderer/core/view/navigation-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';
import { useTask, type TaskStatus } from './hooks/use-task';
import { LifecycleScriptType, TerminalTabItem, useTerminals } from './hooks/use-terminals';

export type RightPanelView = 'changes' | 'files' | 'terminals';
export type MainPanelView = 'agents' | 'editor' | 'diff';

interface TaskViewContext {
  view: MainPanelView;
  setView: (view: MainPanelView) => void;
  projectId: string;
  taskId: string;
  activeConversationId?: string;
  setActiveConversationId: (conversationId: string) => void;
  activeTerminalId?: string;
  setActiveTerminalId: (terminalId: string | undefined) => void;
  rightPanelView: RightPanelView;
  setRightPanelView: (view: RightPanelView) => void;
  taskStatus: TaskStatus;
  task?: Task;
  conversations: Conversation[];
  createConversation: (
    params: Omit<CreateConversationParams, 'projectId' | 'taskId'>
  ) => Promise<Conversation>;
  removeConversation: (conversationId: string) => void;
  terminalTabItems: TerminalTabItem[];
  createTerminal: () => Promise<Terminal>;
  removeTerminal: (terminalId: string) => void;
  projectSettings?: ProjectSettings;
  runLifecycleScript: (type: LifecycleScriptType) => Promise<void>;
}

const TaskViewContext = createContext<TaskViewContext | null>(null);

export function TaskViewWrapper({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  const { getTaskViewState, setTaskViewState } = useTaskViewState();
  const { taskStatus, task } = useTask({ projectId, taskId });
  const { entries, startTracking } = useTaskBootstrapContext();

  useEffect(() => {
    startTracking(projectId, taskId);
  }, [projectId, taskId, startTracking]);
  const { conversations, createConversation, removeConversation } = useConversations({
    projectId,
    taskId,
  });

  const { settings: projectSettings } = useProjectSettings(projectId);

  const { terminalTabItems, createTerminal, removeTerminal, runLifecycleScript } = useTerminals({
    projectId,
    taskId,
    projectSettings,
  });

  const { view, agentsView, terminalsView, rightPanelView } = getTaskViewState(taskId);

  const setView = useCallback(
    (v: MainPanelView) => {
      setTaskViewState(taskId, { view: v });
    },
    [setTaskViewState, taskId]
  );

  const setActiveConversationId = useCallback(
    (conversationId: string) => {
      setTaskViewState(taskId, { agentsView: { activeConversationId: conversationId } });
    },
    [setTaskViewState, taskId]
  );

  const setActiveTerminalId = useCallback(
    (terminalId: string | undefined) => {
      setTaskViewState(taskId, { terminalsView: { activeTerminalId: terminalId } });
    },
    [setTaskViewState, taskId]
  );

  const setRightPanelView = useCallback(
    (view: RightPanelView) => {
      setTaskViewState(taskId, { rightPanelView: view });
    },
    [setTaskViewState, taskId]
  );

  const bootstrapEntry = entries[taskId];
  const isBootstrapping =
    bootstrapEntry?.status === 'bootstrapping' || taskStatus.status === 'pending';

  console.log('[TaskViewWrapper] render', {
    taskId,
    taskStatus: taskStatus.status,
    bootstrapEntryStatus: bootstrapEntry?.status,
    isBootstrapping,
  });

  return (
    <ViewLayoutOverrideContext.Provider value={{ hideRightPanel: isBootstrapping }}>
      <ProjectViewWrapper projectId={projectId}>
        <TaskViewContext.Provider
          value={{
            view,
            setView,
            taskStatus,
            projectId,
            taskId,
            task: task ?? undefined,
            activeConversationId: agentsView.activeConversationId,
            setActiveConversationId,
            activeTerminalId: terminalsView.activeTerminalId,
            setActiveTerminalId,
            rightPanelView,
            setRightPanelView,
            conversations,
            createConversation,
            removeConversation,
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
}

export function useTaskViewContext() {
  const context = useContext(TaskViewContext);
  if (!context) {
    throw new Error('useTaskViewContext must be used within a TaskViewContextProvider');
  }
  return context;
}

export function useReadyTaskViewContext(): TaskViewContext & { task: Task } {
  const context = useTaskViewContext();
  if (!context.task) {
    throw new Error('useReadyTaskViewContext must be used within a ready task');
  }
  return { ...context, task: context.task as Task };
}

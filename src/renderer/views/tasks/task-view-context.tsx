import { createContext, ReactNode, useCallback, useContext, useEffect } from 'react';
import type { Conversation, CreateConversationParams } from '@shared/conversations';
import type { Terminal } from '@shared/terminals';
import { ProjectSettings } from '@main/core/projects/settings/schema';
import { useProjectSettings } from '@renderer/components/project-settings-modal/use-project-settings';
import { useConversations } from '@renderer/core/conversations/use-conversations';
import {
  LifecycleTask,
  useTask,
  useTaskLifecycleContext,
} from '@renderer/core/tasks/task-lifecycle-provider';
import { useTaskViewState } from '@renderer/core/tasks/task-view-state-provider';
import { ViewLayoutOverrideContext } from '@renderer/core/view/navigation-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';
import { LifecycleScriptType, TerminalTabItem, useTerminals } from './hooks/use-terminals';

export type RightPanelView = 'changes' | 'files' | 'terminals';
export type MainPanelView = 'agents' | 'editor' | 'diff';

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
  const lifecycleTask = useTask({ projectId, taskId });

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
      setTaskViewState(taskId, {
        agentsView: { activeConversationId: conversationId, rightPanelView: 'changes' },
      });
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

  const s = lifecycleTask.status;
  const hideRightPanel =
    s === 'creating' || s === 'create-error' || s === 'provisioning' || s === 'provision-error';

  return (
    <ViewLayoutOverrideContext.Provider value={{ hideRightPanel }}>
      <ProjectViewWrapper projectId={projectId}>
        <TaskViewContext.Provider
          value={{
            lifecycleTask,
            view,
            setView,
            projectId,
            taskId,
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

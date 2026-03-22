import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

export type MainPanelView = 'agents' | 'editor' | 'diff';
export type RightPanelView = 'changes' | 'files' | 'terminals';

export type AgentsViewState = {
  activeConversationId?: string;
  rightPanelView: RightPanelView;
};

export type TerminalsViewState = {
  activeTerminalId?: string;
};

export type EditorTab = {
  tabId: string;
  /** Worktree-relative file path (e.g. `src/components/App.tsx`). Not a Monaco URI. */
  uri: string;
};

export type EditorViewState = {
  tabs: EditorTab[];
  activeTabId?: string;
  previewTabId?: string;
  expandedPaths: string[];
};

export interface TaskViewState {
  view: MainPanelView;
  agentsView: AgentsViewState;
  terminalsView: TerminalsViewState;
  editorView: EditorViewState;
  rightPanelView: RightPanelView;
}

const DEFAULT_TASK_VIEW_STATE: TaskViewState = {
  view: 'agents',
  agentsView: {
    rightPanelView: 'changes',
  },
  terminalsView: {},
  editorView: {
    tabs: [],
    expandedPaths: [],
  },
  rightPanelView: 'changes',
};

interface TaskViewStateContextValue {
  getTaskViewState: (taskId: string) => TaskViewState;
  setTaskViewState: (taskId: string, update: Partial<TaskViewState>) => void;
  deleteTaskViewState: (taskId: string) => void;
}

const TaskViewStateContext = createContext<TaskViewStateContextValue | null>(null);

export function TaskViewStateProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, TaskViewState>>({});

  const getTaskViewState = useCallback(
    (taskId: string) => {
      return states[taskId] ?? DEFAULT_TASK_VIEW_STATE;
    },
    [states]
  );

  const setTaskViewState = useCallback((taskId: string, update: Partial<TaskViewState>) => {
    setStates((prev) => {
      const current = prev[taskId] ?? DEFAULT_TASK_VIEW_STATE;
      return {
        ...prev,
        [taskId]: {
          ...current,
          ...update,
          agentsView: { ...current.agentsView, ...update.agentsView },
          terminalsView: { ...current.terminalsView, ...update.terminalsView },
          editorView: { ...current.editorView, ...update.editorView },
        },
      };
    });
  }, []);

  const deleteTaskViewState = useCallback((taskId: string) => {
    setStates((prev) => {
      const { [taskId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return (
    <TaskViewStateContext.Provider
      value={{ getTaskViewState, setTaskViewState, deleteTaskViewState }}
    >
      {children}
    </TaskViewStateContext.Provider>
  );
}

export function useTaskViewState() {
  const ctx = useContext(TaskViewStateContext);
  if (!ctx) {
    throw new Error('useTaskViewState must be used within a TaskViewStateProvider');
  }
  return ctx;
}

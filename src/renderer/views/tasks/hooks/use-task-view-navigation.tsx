import { useCallback, useTransition } from 'react';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { useRequireProvisionedTask } from '../task-view-context';

export function useTaskViewNavigation() {
  const { setCollapsed } = useWorkspaceLayoutContext();
  const taskState = useRequireProvisionedTask();
  const [isPending, startTransition] = useTransition();

  const openAgentsView = useCallback(() => {
    startTransition(() => {
      taskState.setView('agents');
      if (taskState.rightPanelView === 'files') taskState.setRightPanelView('changes');
    });
  }, [taskState]);

  const openEditorView = useCallback(() => {
    startTransition(() => {
      taskState.setView('editor');
      taskState.setRightPanelView('files');
    });
    setCollapsed('right', false);
  }, [taskState, setCollapsed]);

  const openDiffView = useCallback(() => {
    startTransition(() => {
      taskState.setView('diff');
      taskState.setRightPanelView('changes');
    });
    setCollapsed('right', false);
  }, [taskState, setCollapsed]);

  return {
    isPending,
    openAgentsView,
    openEditorView,
    openDiffView,
  };
}

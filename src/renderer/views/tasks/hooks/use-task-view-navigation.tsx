import { useCallback, useTransition } from 'react';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { useProvisionedTask } from '../task-view-context';

export function useTaskViewNavigation() {
  const provisionedTask = useProvisionedTask();
  const { setCollapsed } = useWorkspaceLayoutContext();
  const [isPending, startTransition] = useTransition();

  const openAgentsView = useCallback(() => {
    startTransition(() => {
      const { taskView } = provisionedTask;
      taskView.setView('agents');
      if (taskView.rightPanelView === 'files') taskView.setRightPanelView('changes');
    });
  }, [provisionedTask]);

  const openEditorView = useCallback(() => {
    startTransition(() => {
      const { taskView } = provisionedTask;
      taskView.setView('editor');
      taskView.setRightPanelView('files');
    });
    setCollapsed('right', false);
  }, [provisionedTask, setCollapsed]);

  const openDiffView = useCallback(() => {
    startTransition(() => {
      const { taskView } = provisionedTask;
      taskView.setView('diff');
      taskView.setRightPanelView('changes');
    });
    setCollapsed('right', false);
  }, [provisionedTask, setCollapsed]);

  return {
    isPending,
    openAgentsView,
    openEditorView,
    openDiffView,
  };
}

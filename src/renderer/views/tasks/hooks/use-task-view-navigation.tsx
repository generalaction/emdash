import { useCallback, useTransition } from 'react';
import { getTaskView } from '@renderer/core/stores/task-selectors';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { useTaskViewContext } from '../task-view-context';

export function useTaskViewNavigation() {
  const { projectId, taskId } = useTaskViewContext();
  const { setCollapsed } = useWorkspaceLayoutContext();
  const [isPending, startTransition] = useTransition();

  const openAgentsView = useCallback(() => {
    startTransition(() => {
      const taskView = getTaskView(projectId, taskId);
      taskView?.setView('agents');
      if (taskView?.rightPanelView === 'files') taskView?.setRightPanelView('changes');
    });
  }, [projectId, taskId]);

  const openEditorView = useCallback(() => {
    startTransition(() => {
      const taskView = getTaskView(projectId, taskId);
      taskView?.setView('editor');
      taskView?.setRightPanelView('files');
    });
    setCollapsed('right', false);
  }, [projectId, taskId, setCollapsed]);

  const openDiffView = useCallback(() => {
    startTransition(() => {
      const taskView = getTaskView(projectId, taskId);
      taskView?.setView('diff');
      taskView?.setRightPanelView('changes');
    });
    setCollapsed('right', false);
  }, [projectId, taskId, setCollapsed]);

  return {
    isPending,
    openAgentsView,
    openEditorView,
    openDiffView,
  };
}

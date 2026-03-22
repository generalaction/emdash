import { useCallback, useTransition } from 'react';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { useTaskViewContext } from '../task-view-context';

export function useTaskViewNavigation() {
  const { setCollapsed } = useWorkspaceLayoutContext();
  const { setRightPanelView, setView, rightPanelView } = useTaskViewContext();
  const [isPending, startTransition] = useTransition();

  const openAgentsView = useCallback(() => {
    startTransition(() => {
      setView('agents');
      if (rightPanelView === 'files') setRightPanelView('changes');
    });
  }, [setView, rightPanelView, setRightPanelView]);

  const openEditorView = useCallback(() => {
    startTransition(() => {
      setView('editor');
      setRightPanelView('files');
    });
    setCollapsed('right', false);
  }, [setView, setRightPanelView, setCollapsed]);

  const openDiffView = useCallback(() => {
    startTransition(() => {
      setView('diff');
      setRightPanelView('changes');
    });
    setCollapsed('right', false);
  }, [setView, setRightPanelView, setCollapsed]);

  return {
    isPending,
    openAgentsView,
    openEditorView,
    openDiffView,
  };
}

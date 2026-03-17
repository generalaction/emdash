import { useCallback } from 'react';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { useTaskViewContext } from '../task-view-context';

export function useTaskViewNavigation() {
  const { setCollapsed } = useWorkspaceLayoutContext();
  const { setRightPanelView, setView, rightPanelView } = useTaskViewContext();

  const openAgentsView = useCallback(() => {
    setView('agents');
    if (rightPanelView === 'files') setRightPanelView('changes');
  }, [setView, rightPanelView, setRightPanelView]);

  const openEditorView = useCallback(() => {
    setView('editor');
    setRightPanelView('files');
    setCollapsed('right', false);
  }, [setView, setRightPanelView, setCollapsed]);

  const openDiffView = useCallback(() => {
    setView('diff');
    setRightPanelView('changes');
    setCollapsed('right', false);
  }, [setView, setRightPanelView, setCollapsed]);

  return {
    openAgentsView,
    openEditorView,
    openDiffView,
  };
}

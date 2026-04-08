import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { getTaskView } from '@renderer/core/stores/task-selectors';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { ChangesPanel } from './diff-view/changes-panel/changes-panel';
import { EditorFileTree } from './editor/editor-file-tree';
import { useTaskViewContext } from './task-view-context';
import { TerminalsPanel } from './terminals/terminal-panel';

export const TaskRightSidebar = observer(function TaskRightSidebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskView = getTaskView(projectId, taskId);
  const { isRightOpen } = useWorkspaceLayoutContext();

  const prevIsRightOpenRef = useRef(isRightOpen);
  useEffect(() => {
    if (prevIsRightOpenRef.current && !isRightOpen) {
      taskView?.setFocusedRegion('main');
    }
    prevIsRightOpenRef.current = isRightOpen;
  }, [isRightOpen, taskView]);

  if (!taskView) return null;

  switch (taskView.rightPanelView) {
    case 'changes':
      return <ChangesPanel />;
    case 'files':
      return <EditorFileTree />;
    case 'terminals':
      return <TerminalsPanel />;
  }
});

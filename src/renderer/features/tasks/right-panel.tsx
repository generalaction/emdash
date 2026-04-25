import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ChangesPanel } from './diff-view/changes-panel/changes-panel';
import { EditorFileTree } from './editor/editor-file-tree';
import { TerminalsPanel } from './terminals/terminal-panel';

export const TaskRightSidebar = observer(function TaskRightSidebar() {
  const { taskView } = useProvisionedTask();
  const { isRightOpen } = useWorkspaceLayoutContext();

  const prevIsRightOpenRef = useRef(isRightOpen);
  useEffect(() => {
    if (prevIsRightOpenRef.current && !isRightOpen) {
      taskView.setFocusedRegion('main');
    }
    prevIsRightOpenRef.current = isRightOpen;
  }, [isRightOpen, taskView]);

  switch (taskView.rightPanelView) {
    case 'changes':
      return <ChangesPanel />;
    case 'files':
      return <EditorFileTree />;
    case 'terminals':
      return <TerminalsPanel />;
  }
});

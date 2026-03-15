import type { ViewDefinition } from '@renderer/contexts/workspace-views-registry';
import { TaskViewWrapper } from '@renderer/views/tasks/task-view-wrapper';
import { TaskMainPanel } from './main-panel';
import { TaskRightSidebar } from './right-panel';
import { TaskTitlebar } from './task-titlebar';

export const taskView = {
  WrapView: TaskViewWrapper,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  RightPanel: TaskRightSidebar,
} satisfies ViewDefinition<{ projectId: string; taskId: string }>;

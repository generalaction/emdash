import { ProjectViewWrapper } from '@renderer/features/projects/components/project-view-wrapper';
import { ProjectMainPanel } from './components/main-panel/main-panel';
import { ProjectTitlebar } from './components/project-titlebar';

export const projectView = {
  WrapView: ProjectViewWrapper,
  TitlebarSlot: ProjectTitlebar,
  MainPanel: ProjectMainPanel,
};

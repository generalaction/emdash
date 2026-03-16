import {
  ProjectViewWrapper,
  useCurrentProject,
  useCurrentProjectStatus,
} from '@renderer/views/projects/project-view-wrapper';
import { ActiveProject } from './active-project';
import { PendingProjectStatus } from './pending-project';
import { ProjectTitlebar } from './titlebar';

export const projectView = {
  WrapView: ProjectViewWrapper,
  TitlebarSlot: ProjectTitlebar,
  MainPanel: ProjectMainPanel,
};

export function ProjectMainPanel() {
  const project = useCurrentProject();
  const status = useCurrentProjectStatus();

  if (status.status === 'creating') {
    return <PendingProjectStatus pending={status.pending} />;
  }

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground" />;
  }

  return <ActiveProject />;
}

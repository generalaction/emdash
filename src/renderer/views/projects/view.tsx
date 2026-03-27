import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { isUnregisteredProject } from '@renderer/core/stores/project';
import {
  getProjectStore,
  projectViewKind,
  unmountedMountErrorMessage,
} from '@renderer/core/stores/project-selectors';
import { useParams } from '@renderer/core/view/navigation-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';
import { ActiveProject } from './active-project';
import { PendingProjectStatus } from './pending-project';
import { ProjectTitlebar } from './titlebar';

export const ProjectMainPanel = observer(function ProjectMainPanel() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectStore(projectId);
  const kind = projectViewKind(store);

  if (kind === 'creating' && store && isUnregisteredProject(store)) {
    return <PendingProjectStatus project={store} />;
  }

  if (kind === 'bootstrapping') {
    return <ProjectBootstrappingPanel />;
  }

  if (kind === 'mount_error') {
    return <ProjectBootstrapErrorPanel message={unmountedMountErrorMessage(store)} />;
  }

  if (kind !== 'ready') {
    return <div className="flex flex-1 items-center justify-center text-foreground-muted" />;
  }

  return <ActiveProject />;
});

function ProjectBootstrappingPanel() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-foreground-passive" />
      <p className="text-xs font-mono text-foreground-passive">Setting up project…</p>
    </div>
  );
}

function ProjectBootstrapErrorPanel({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-xs flex-col items-center text-center gap-2">
        <p className="text-sm font-medium font-mono text-foreground-destructive">
          Failed to set up project
        </p>
        <p className="text-xs font-mono text-foreground-passive">{message}</p>
      </div>
    </div>
  );
}

export const projectView = {
  WrapView: ProjectViewWrapper,
  TitlebarSlot: ProjectTitlebar,
  MainPanel: ProjectMainPanel,
};

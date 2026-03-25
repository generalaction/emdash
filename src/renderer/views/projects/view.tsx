import { Loader2 } from 'lucide-react';
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
    return <PendingProjectStatus project={status.pending} />;
  }

  if (status.status === 'bootstrapping') {
    return <ProjectBootstrappingPanel />;
  }

  if (status.status === 'error') {
    return <ProjectBootstrapErrorPanel message={status.message} />;
  }

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground" />;
  }

  return <ActiveProject />;
}

function ProjectBootstrappingPanel() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
      <p className="text-xs font-mono text-muted-foreground/50">Setting up project…</p>
    </div>
  );
}

function ProjectBootstrapErrorPanel({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-xs flex-col items-center text-center gap-2">
        <p className="text-sm font-medium font-mono text-destructive">Failed to set up project</p>
        <p className="text-xs font-mono text-muted-foreground/70">{message}</p>
      </div>
    </div>
  );
}

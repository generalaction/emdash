import { usePendingProjectsContext } from '@renderer/components/add-project-modal/pending-projects-provider';
import OpenInMenu from '@renderer/components/titlebar/OpenInMenu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { useViewParams } from '@renderer/contexts/WorkspaceNavigationContext';
import {
  useCurrentProject,
  useCurrentProjectStatus,
} from '@renderer/views/projects/project-view-wrapper';

export function ProjectTitlebar() {
  const project = useCurrentProject();
  const status = useCurrentProjectStatus();
  const { params } = useViewParams('project');
  const { pendingProjects } = usePendingProjectsContext();

  const pendingName =
    status === 'creating'
      ? (pendingProjects.find((p) => p.id === params.projectId)?.name ?? null)
      : null;

  const displayName = project?.name ?? pendingName;
  const currentPath = project?.isRemote ? project?.remotePath : project?.path || null;

  return (
    <Titlebar
      leftSlot={
        displayName && (
          <div className="flex items-center px-2">
            <span className="text-[13px] font-medium text-muted-foreground">{displayName}</span>
          </div>
        )
      }
      rightSlot={
        currentPath && (
          <OpenInMenu
            path={currentPath}
            align="right"
            isRemote={project?.isRemote || false}
            sshConnectionId={project?.sshConnectionId || null}
          />
        )
      }
    />
  );
}

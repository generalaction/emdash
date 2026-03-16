import OpenInMenu from '@renderer/components/titlebar/OpenInMenu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import {
  useCurrentProject,
  useCurrentProjectStatus,
} from '@renderer/views/projects/project-view-wrapper';

export function ProjectTitlebar() {
  const project = useCurrentProject();
  const status = useCurrentProjectStatus();

  const displayName = project?.name ?? (status.status === 'creating' ? status.pending.name : null);
  const currentPath = project?.isRemote ? project?.remotePath : project?.path || null;

  return (
    <Titlebar
      leftSlot={
        displayName && (
          <div className="flex items-center px-2">
            <span className="text-sm text-muted-foreground">{displayName}</span>
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

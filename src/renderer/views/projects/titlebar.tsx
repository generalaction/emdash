import { observer } from 'mobx-react-lite';
import OpenInMenu from '@renderer/components/titlebar/OpenInMenu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { getProjectStore } from '@renderer/core/stores/project-selectors';
import { useParams } from '@renderer/core/view/navigation-provider';

export const ProjectTitlebar = observer(function ProjectTitlebar() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectStore(projectId);

  const displayName =
    store?.state === 'mounted' || store?.state === 'unmounted'
      ? store.data?.name
      : store?.state === 'unregistered'
        ? store.name
        : null;

  const project = store?.state === 'mounted' ? store.data : null;
  const currentPath = project?.path ?? null;
  const isRemote = project?.type === 'ssh';
  const sshConnectionId = project?.type === 'ssh' ? project.connectionId : null;

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
        currentPath ? (
          <OpenInMenu
            path={currentPath}
            align="right"
            isRemote={isRemote}
            sshConnectionId={sshConnectionId}
          />
        ) : null
      }
    />
  );
});

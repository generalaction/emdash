import { observer } from 'mobx-react-lite';
import { OpenInMenu } from '@renderer/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import {
  asMounted,
  getProjectStore,
  projectDisplayName,
  projectViewKind,
} from '@renderer/core/stores/project-selectors';
import type { ProjectView } from '@renderer/core/stores/project-view';
import { useParams } from '@renderer/core/view/navigation-provider';

export const ProjectTitlebar = observer(function ProjectTitlebar() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectStore(projectId);
  const kind = projectViewKind(store);
  const displayName = projectDisplayName(store);

  const nameSlot = displayName ? (
    <div className="flex items-center px-2">
      <span className="text-sm text-muted-foreground">{displayName}</span>
    </div>
  ) : null;

  if (kind !== 'ready') {
    return <Titlebar leftSlot={nameSlot} />;
  }

  const mounted = asMounted(store);
  if (!mounted) return <Titlebar leftSlot={nameSlot} />;

  const isRemote = mounted.data.type === 'ssh';
  const sshConnectionId = mounted.data.type === 'ssh' ? mounted.data.connectionId : null;

  return (
    <Titlebar
      leftSlot={nameSlot}
      rightSlot={
        <div className="flex items-center gap-2 mr-2">
          <OpenInMenu
            path={mounted.data.path}
            isRemote={isRemote}
            sshConnectionId={sshConnectionId}
            className="h-7 bg-background"
          />
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[mounted.view.activeView]}
            className="rounded-lg overflow-hidden shadow-none h-7 border border-border mx-1"
            onValueChange={([value]) => {
              if (value) mounted.view.setProjectView(value as ProjectView);
            }}
          >
            <ToggleGroupItem value="tasks" size="sm">
              Tasks
            </ToggleGroupItem>
            <ToggleGroupItem value="pull-request" size="sm">
              Pull Requests
            </ToggleGroupItem>
            <ToggleGroupItem value="settings" size="sm">
              Settings
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      }
    />
  );
});

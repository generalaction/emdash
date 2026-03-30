import { observer } from 'mobx-react-lite';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { asMounted, getProjectStore } from '@renderer/core/stores/project-selectors';
import type { ProjectView } from '@renderer/core/stores/project-view';
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

  const mounted = asMounted(store) ?? null;

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
        mounted && (
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[mounted.view.activeView]}
            className="rounded-lg overflow-hidden shadow-none h-7 border border-border mx-1 mr-2 "
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
        )
      }
    />
  );
});

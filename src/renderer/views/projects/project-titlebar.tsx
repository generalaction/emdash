import { Ellipsis, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { OpenInMenu } from '@renderer/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import {
  asMounted,
  getProjectManagerStore,
  getProjectStore,
  projectDisplayName,
  projectViewKind,
} from '@renderer/core/stores/project-selectors';
import type { ProjectView } from '@renderer/core/stores/project-view';
import { useNavigate, useParams } from '@renderer/core/view/navigation-provider';

export const ProjectTitlebar = observer(function ProjectTitlebar() {
  const {
    params: { projectId },
  } = useParams('project');
  const { navigate } = useNavigate();
  const store = getProjectStore(projectId);
  const kind = projectViewKind(store);
  const displayName = projectDisplayName(store);

  const showConfirmDeleteProject = useShowModal('confirmActionModal');

  const nameSlot = displayName ? (
    <div className="flex items-center px-2 gap-2">
      <span className="text-sm text-muted-foreground">{displayName}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Project actions"
              className="text-foreground-muted hover:text-foreground"
            />
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-40">
          <DropdownMenuItem
            className="flex items-center gap-2 text-foreground-destructive"
            onClick={() => {
              showConfirmDeleteProject({
                title: 'Delete project',
                description: `"${displayName}" will be deleted. The project folder and worktrees will stay on the filesystem.`,
                confirmLabel: 'Delete',
                onSuccess: () => {
                  void getProjectManagerStore().deleteProject(projectId);
                  navigate('home');
                },
              });
            }}
          >
            <Trash2 className="size-4 " />
            Remove Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

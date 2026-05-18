import { FolderPlus, ListFilter } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { MicroLabel } from '@renderer/lib/ui/label';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export const ProjectsGroupLabel = observer(function ProjectsGroupLabel() {
  const showAddProjectModal = useShowModal('addProjectModal');

  return (
    <div className="flex items-center justify-between pl-5 pr-2.5 h-[40px]">
      <MicroLabel className="text-foreground-tertiary-passive">Projects</MicroLabel>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger>
              <DropdownMenuTrigger>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Sort projects"
                  className="hover:bg-transparent text-foreground-muted hover:text-foreground"
                >
                  <ListFilter />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Sort by</TooltipContent>
          </Tooltip>
          <DropdownMenuContent className="min-w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sidebarStore.taskSortBy}>
                <DropdownMenuRadioItem
                  value="created-at"
                  onClick={() => sidebarStore.applySort('created-at')}
                >
                  Created at
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="updated-at"
                  onClick={() => sidebarStore.applySort('updated-at')}
                >
                  Last used
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => showAddProjectModal({})}
              aria-label="Add Project"
              className="hover:bg-transparent text-foreground-muted hover:text-foreground"
            >
              <FolderPlus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Add Project
            <ShortcutHint settingsKey="newProject" />
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

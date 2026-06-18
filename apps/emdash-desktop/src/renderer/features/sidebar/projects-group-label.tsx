import { FolderPlus, ListFilter } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { buttonVariants } from '@renderer/lib/ui/button';
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
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export const ProjectsGroupLabel = observer(function ProjectsGroupLabel() {
  const showAddProjectModal = useShowModal('addProjectModal');

  return (
    <div className="flex h-[40px] items-center justify-between pr-2.5 pl-5">
      <MicroLabel className="text-foreground-passive">Projects</MicroLabel>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <Tooltip>
            <DropdownMenuTrigger
              render={
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Sort projects"
                      className={buttonVariants({
                        size: 'icon-xs',
                        variant: 'ghost',
                        className:
                          'hover:bg-transparent text-foreground-muted hover:text-foreground',
                      })}
                    >
                      <ListFilter />
                    </button>
                  }
                />
              }
            />
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
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => showAddProjectModal({})}
                aria-label="Add Project"
                className={buttonVariants({
                  size: 'icon-xs',
                  variant: 'ghost',
                  className: 'hover:bg-transparent text-foreground-muted hover:text-foreground',
                })}
              >
                <FolderPlus />
              </button>
            }
          />
          <TooltipContent>
            Add Project
            <BoundShortcut settingsKey="newProject" variant="badge" />
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

import { FolderPlus, ListFilter } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { buttonVariants } from '@core/primitives/ui/browser/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@core/primitives/ui/browser/dropdown-menu';
import { MicroLabel } from '@core/primitives/ui/browser/label';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@core/primitives/ui/browser/tooltip';
import { sidebarStore } from '@renderer/lib/stores/app-state';

export const ProjectsGroupLabel = observer(function ProjectsGroupLabel() {
  const openAddProjectModal = useOpenModal('addProjectModal');

  return (
    <div className="flex h-[40px] items-center justify-between pr-2.5 pl-5">
      <MicroLabel className="font-medium text-foreground-tertiary-passive">Projects</MicroLabel>
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
                onClick={() => void openAddProjectModal({})}
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
            <BoundShortcut command="app.newProject" variant="keycaps" />
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

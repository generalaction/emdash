import { ListFilter } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { sidebarStore } from '@renderer/core/stores/app-state';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { MicroLabel } from '../ui/label';

export const ProjectsGroupLabel = observer(function ProjectsGroupLabel() {
  return (
    <div className="flex items-center justify-between pl-5 pr-2.5 h-[40px]">
      <MicroLabel className="text-foreground-tertiary-passive">Projects</MicroLabel>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button size="icon-xs" variant="ghost">
            <ListFilter />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sidebarStore.taskSortBy}
              onValueChange={(value) => {
                if (value === 'created-at' || value === 'updated-at') {
                  sidebarStore.setTaskSortBy(value);
                }
              }}
            >
              <DropdownMenuRadioItem value="created-at">Created at</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated-at">Updated at</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Display</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={sidebarStore.showSidebarTaskStatus}
              onCheckedChange={(checked) => sidebarStore.setShowSidebarTaskStatus(checked === true)}
            >
              Show task status
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={sidebarStore.taskGroupBy === 'task-status'}
              onCheckedChange={(checked) =>
                sidebarStore.setTaskGroupBy(checked === true ? 'task-status' : 'none')
              }
            >
              Group by task status
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

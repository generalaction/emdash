import { ListFilter } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { sidebarStore } from '@renderer/core/stores/app-state';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { MicroLabel } from '../../components/ui/label';

export const ProjectsGroupLabel = observer(function ProjectsGroupLabel() {
  return (
    <div className="flex items-center justify-between pl-5 pr-2.5 h-[40px]">
      <MicroLabel className="text-foreground-tertiary-passive">Projects</MicroLabel>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button
            size="icon-xs"
            variant="ghost"
            className="hover:bg-transparent text-foreground-muted hover:text-foreground"
          >
            <ListFilter />
          </Button>
        </DropdownMenuTrigger>
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
                Updated at
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

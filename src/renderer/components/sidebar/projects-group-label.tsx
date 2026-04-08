import { ListFilter } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { sidebarStore } from '@renderer/core/stores/app-state';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { MicroLabel } from '../ui/label';

export const ProjectsGroupLabel = observer(function ProjectsGroupLabel() {
  return (
    <div className="flex items-center justify-between pl-3 pr-1">
      <MicroLabel className="text-foreground-tertiary-passive">Projects</MicroLabel>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button size="icon-xs" variant="ghost">
            <ListFilter />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={sidebarStore.showSidebarTaskStatus}
            onCheckedChange={(checked) => sidebarStore.setShowSidebarTaskStatus(checked === true)}
          >
            Show task status
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

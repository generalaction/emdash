import { ListFilter } from 'lucide-react';
import React from 'react';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { MicroLabel } from '../ui/label';

export function ProjectsGroupLabel() {
  return (
    <div className="flex items-center justify-between pl-3 pr-1">
      <MicroLabel className="text-foreground-tertiary-passive">Projects</MicroLabel>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button size="icon-xs" variant="ghost">
            <ListFilter />
          </Button>
        </DropdownMenuTrigger>
      </DropdownMenu>
    </div>
  );
}

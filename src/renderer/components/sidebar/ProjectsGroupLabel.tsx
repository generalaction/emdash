import { FolderOpen, FolderPlus, Plus, Server } from 'lucide-react';
import { SiGit } from 'react-icons/si';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { SidebarGroupLabel } from '../ui/sidebar';
import React from 'react';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';

export function ProjectsGroupLabel() {
  const {
    handleOpenProject: onOpenProject,
    handleNewProjectClick: onNewProject,
    handleCloneProjectClick: onCloneProject,
    handleAddRemoteProject: onAddRemoteProject,
  } = useProjectManagementContext();
  return (
    <SidebarGroupLabel className="flex items-center justify-between pr-0">
      <span className="cursor-default select-none text-sm font-medium normal-case tracking-normal text-foreground/30">
        Projects
      </span>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-foreground/30">
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start" sideOffset={4}>
          <div className="space-y-1">
            <MenuItemButton
              icon={FolderOpen}
              label="Open Folder"
              ariaLabel="Open"
              onClick={() => onOpenProject?.()}
            />
            <MenuItemButton
              icon={Plus}
              label="Create New"
              ariaLabel="New"
              onClick={() => onNewProject?.()}
            />
            <MenuItemButton
              icon={SiGit}
              label="Clone"
              ariaLabel="Clone"
              onClick={() => onCloneProject?.()}
            />
            <MenuItemButton
              icon={Server}
              label="Remote Project"
              ariaLabel="Remote Project"
              onClick={() => onAddRemoteProject?.()}
            />
          </div>
        </PopoverContent>
      </Popover>
    </SidebarGroupLabel>
  );
}

interface MenuItemButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}

const MenuItemButton = React.memo<MenuItemButtonProps>(
  ({ icon: Icon, label, ariaLabel, onClick }) => {
    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      },
      [onClick]
    );

    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={0}
        aria-label={ariaLabel}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted dark:text-muted-foreground dark:hover:bg-accent"
        onClick={onClick}
        onKeyDown={handleKeyDown}
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  }
);
MenuItemButton.displayName = 'MenuItemButton';

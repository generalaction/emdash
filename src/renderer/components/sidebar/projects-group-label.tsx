import { FolderPlus } from 'lucide-react';
import React from 'react';
import { Button } from '@renderer/components/ui/button';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { SidebarGroupLabel } from './sidebar-primitives';

export function ProjectsGroupLabel() {
  const showAddProjectModal = useShowModal('addProjectModal');

  return (
    <SidebarGroupLabel className="flex items-center justify-between pl-3 pr-1">
      <span className="cursor-default select-none text-xs font-medium normal-case tracking-normal text-muted-foreground">
        Projects
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-foreground/30 h-7 w-7"
        onClick={() => showAddProjectModal({})}
      >
        <FolderPlus className="h-4 w-4" />
      </Button>
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

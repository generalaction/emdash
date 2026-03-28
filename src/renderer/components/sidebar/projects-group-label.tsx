import React from 'react';
import { MicroLabel } from '../ui/label';

export function ProjectsGroupLabel() {
  return (
    <div className="flex items-center justify-between pl-3 pr-1">
      <MicroLabel className="text-foreground-tertiary-passive">Projects</MicroLabel>
    </div>
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

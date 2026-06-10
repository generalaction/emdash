import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

/**
 * Popover-backed filter trigger shared by list views (tasks, pull requests).
 * Owns the trigger styling (active/muted label + chevron) and popover shell;
 * callers supply the filter body (option list, search, checkboxes) as children.
 */
export function FilterMenuButton({
  label,
  active,
  disabled,
  badge,
  contentClassName,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  badge?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'flex items-center gap-1 text-sm hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
          active ? 'font-medium text-foreground' : 'text-foreground-muted'
        )}
      >
        {label}
        {badge}
        <ChevronDownIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('w-56 gap-0 p-2', contentClassName)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

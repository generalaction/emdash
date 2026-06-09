import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';

interface ListFilterButtonProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function ListFilterButton({ label, active, disabled, children }: ListFilterButtonProps) {
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className={
          'inline-flex items-center gap-0.5 text-sm hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40' +
          (active ? ' font-medium text-foreground' : ' text-foreground-muted')
        }
      >
        {label}
        <ChevronDownIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-0 p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

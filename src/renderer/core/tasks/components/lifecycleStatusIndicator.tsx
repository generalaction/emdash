import { useState } from 'react';
import { TaskLifecycleStatus } from '@shared/tasks';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/components/ui/combobox';
import { cn } from '@renderer/lib/utils';

type StatusOption = { value: TaskLifecycleStatus; label: string };

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

function StatusIcon({ status, className }: { status: TaskLifecycleStatus; className?: string }) {
  switch (status) {
    case 'todo':
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className={cn(
            'size-3 text-foreground-tertiary-muted hover:text-foreground-tertiary',
            className
          )}
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'done':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          stroke="currentColor"
          fill="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 512 512"
          className={cn('size-3 fill-status-done hover:fill-status-done-hover', className)}
          height="1em"
          width="1em"
        >
          <path d="M504 256c0 136.967-111.033 248-248 248S8 392.967 8 256 119.033 8 256 8s248 111.033 248 248zM227.314 387.314l184-184c6.248-6.248 6.248-16.379 0-22.627l-22.627-22.627c-6.248-6.249-16.379-6.249-22.628 0L216 308.118l-70.059-70.059c-6.248-6.248-16.379-6.248-22.628 0l-22.627 22.627c-6.248 6.248-6.248 16.379 0 22.627l104 104c6.249 6.249 16.379 6.249 22.628.001z" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg
          stroke="currentColor"
          fill="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 512 512"
          className={cn('size-3 fill-status-canceled hover:fill-status-canceled-hover', className)}
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"></path>
        </svg>
      );
    case 'in_progress':
      return (
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={cn(
            'size-3 text-status-in-progress hover:text-status-in-progress-hover',
            className
          )}
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none"></circle>
          <path d="M 8 3 A 5 5 0 0 1 8 13 L 8 8 Z" fill="currentColor"></path>
        </svg>
      );
    case 'review':
      return (
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={cn(
            'size-3 text-status-in-review hover:text-status-in-review-hover',
            className
          )}
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none"></circle>
          <path d="M 8 3 A 5 5 0 1 1 3 8 L 8 8 Z" fill="currentColor"></path>
        </svg>
      );
    default:
      return null;
  }
}

export function LifecycleStatusIndicator({
  lifecycleStatus,
  onLifecycleStatusChange,
}: {
  lifecycleStatus: TaskLifecycleStatus;
  onLifecycleStatusChange: (lifecycleStatus: TaskLifecycleStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption =
    STATUS_OPTIONS.find((o) => o.value === lifecycleStatus) ?? STATUS_OPTIONS[0];

  return (
    <Combobox
      items={STATUS_OPTIONS}
      value={selectedOption}
      onValueChange={(item) => {
        if (item) {
          onLifecycleStatusChange(item.value);
          setOpen(false);
        }
      }}
      open={open}
      onOpenChange={setOpen}
      isItemEqualToValue={(a: StatusOption, b: StatusOption) => a.value === b.value}
      filter={(item: StatusOption, query) => item.label.toLowerCase().includes(query.toLowerCase())}
      autoHighlight
    >
      <ComboboxTrigger
        className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-background-tertiary-2 group-data-[active=true]/row:hover:bg-background-tertiary-3"
        onMouseDown={(e) => e.preventDefault()}
      >
        <StatusIcon status={lifecycleStatus} />
      </ComboboxTrigger>
      <ComboboxContent className="w-40" align="start">
        <ComboboxInput showTrigger={false} placeholder="Search status..." />
        <ComboboxList className="py-1">
          <ComboboxCollection>
            {(item: StatusOption) => (
              <ComboboxItem key={item.value} value={item}>
                <StatusIcon status={item.value} className="shrink-0" />
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

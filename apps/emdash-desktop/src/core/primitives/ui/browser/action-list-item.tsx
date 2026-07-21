import { type LucideIcon } from 'lucide-react';
import { cn } from '@core/primitives/ui/browser/cn';
import { Shortcut } from '@core/primitives/ui/browser/shortcut';

export function ActionListItem({
  label,
  description,
  icon: Icon,
  isSelected,
  disabled,
  disabledReason,
  onClick,
  onMouseEnter,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  isSelected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      type="button"
      data-slot="button"
      aria-label={label}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={disabled ? undefined : onMouseEnter}
      className={cn(
        'group flex w-full items-center justify-between rounded-lg bg-background p-4 text-left transition-all',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-background-1',
        !disabled && isSelected && 'bg-background-1'
      )}
    >
      <div className="flex items-center gap-3">
        <Icon className="size-7 text-foreground-passive transition-colors" strokeWidth={1} />
        <div className="flex flex-col gap-1">
          <span
            className={cn(
              'whitespace-nowrap leading-none tracking-normal text-sm text-foreground-muted transition-colors',
              !disabled && isSelected && 'text-foreground'
            )}
          >
            {label}
          </span>
          <span className="text-xs text-foreground-passive">
            {disabled && disabledReason ? disabledReason : description}
          </span>
        </div>
      </div>
      {!disabled && isSelected && <Shortcut hotkey="Enter" variant="keycaps" />}
    </button>
  );
}

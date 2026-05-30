import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

interface OptionButtonCardProps {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  description: string;
  className?: string;
}

export function OptionButtonCard({
  active,
  onClick,
  icon,
  title,
  description,
  className,
}: OptionButtonCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors',
        active
          ? 'border-border text-foreground bg-background-2'
          : 'border-border text-foreground-muted hover:bg-background-2',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-foreground-muted')}>
          {icon}
        </span>
        <span className="text-sm">{title}</span>
      </div>
      <p className="text-xs text-foreground-muted">{description}</p>
    </button>
  );
}

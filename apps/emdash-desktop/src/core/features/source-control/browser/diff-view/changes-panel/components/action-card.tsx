import { surface } from '@emdash/ui/styles/recipes/surface';
import { type ReactNode } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';

interface ActionCardProps {
  selectedCount: number;
  selectionActions: ReactNode;
  generalActions: ReactNode;
}

export function ActionCard({ selectedCount, selectionActions, generalActions }: ActionCardProps) {
  const hasSelection = selectedCount > 0;
  return (
    <div
      className={cn(
        surface({ level: 'overlay' }),
        'mx-2 flex shrink-0 items-center justify-between overflow-hidden rounded-lg border border-border p-2'
      )}
    >
      <span className="min-w-0 truncate text-xs text-foreground-muted">
        {hasSelection
          ? `${selectedCount} file${selectedCount !== 1 ? 's' : ''} selected`
          : 'All files'}
      </span>
      <div className="flex items-center gap-1.5">
        {hasSelection ? selectionActions : generalActions}
      </div>
    </div>
  );
}

import { ReactNode } from 'react';

interface ActionCardProps {
  selectedCount: number;
  selectionActions: ReactNode;
  generalActions: ReactNode;
}

export function ActionCard({ selectedCount, selectionActions, generalActions }: ActionCardProps) {
  const hasSelection = selectedCount > 0;
  return (
    <div className="shrink-0 mx-2 mb-2 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
      <span className="text-xs text-muted-foreground">
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

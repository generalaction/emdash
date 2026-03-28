import { ChevronDown, Plus } from 'lucide-react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { SelectionState } from '@renderer/core/stores/changes-view-store';
import { cn } from '@renderer/lib/utils';

interface SectionHeaderProps {
  label: string;
  count: number;
  selectionState: SelectionState;
  onToggleAll: () => void;
  actions?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function SectionHeader({
  label,
  count,
  selectionState,
  onToggleAll,
  actions,
  collapsed,
  onToggleCollapsed,
}: SectionHeaderProps) {
  return (
    <div className="shrink-0 flex items-center justify-between px-2.5 h-10">
      <div className="flex items-center gap-2 justify-between w-full">
        <button onClick={onToggleCollapsed}>
          <span className="text-sm text-foreground-muted flex items-center gap-2">
            <span>{label}</span> <Badge variant="secondary">{count}</Badge>{' '}
            <span className="p-2 text-foreground-muted hover:text-foreground">
              <ChevronDown
                className={cn(
                  'size-4 transition-transform duration-200 ease-in-out',
                  collapsed ? '-rotate-90' : 'rotate-0'
                )}
              />
            </span>
          </span>
        </button>
        <Checkbox
          checked={selectionState === 'all'}
          indeterminate={selectionState === 'partial'}
          onCheckedChange={onToggleAll}
          aria-label={`Select all ${label.toLowerCase()}`}
          className="mr-0.5"
        />
      </div>
      {actions}
    </div>
  );
}

export function PullRequestSectionHeader({
  count,
  collapsed,
  onToggleCollapsed,
  onCreatePr,
}: {
  count: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onCreatePr?: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between px-2.5 h-10">
      <div className="flex items-center gap-2 justify-between w-full min-w-0">
        <button onClick={onToggleCollapsed} className="min-w-0">
          <span className="text-sm text-foreground-muted flex items-center gap-2 min-w-0">
            <span className="truncate">Pull Requests</span>{' '}
            <Badge variant="secondary" className="shrink-0">
              {count}
            </Badge>
            <span className="p-2 text-foreground-muted hover:text-foreground">
              <ChevronDown
                className={cn(
                  'size-4 transition-transform duration-200 ease-in-out',
                  collapsed ? '-rotate-90' : 'rotate-0'
                )}
              />
            </span>
          </span>
        </button>
        <Button variant="outline" size="xs" onClick={onCreatePr}>
          <Plus className="size-3" />
          Create PR
        </Button>
      </div>
    </div>
  );
}

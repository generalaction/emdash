import { ChevronDown, Plus } from 'lucide-react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { cn } from '@renderer/lib/utils';
import { SelectionState } from '../state/use-selection';

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
    <div className="shrink-0 flex items-center justify-between px-2.5 py-2 ">
      <div className="flex items-center gap-2 justify-between w-full">
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          <span>{label}</span> <Badge variant="secondary">{count}</Badge>{' '}
          <button
            onClick={onToggleCollapsed}
            className="p-2 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                'size-4 transition-transform duration-200 ease-in-out',
                collapsed ? '-rotate-90' : 'rotate-0'
              )}
            />
          </button>
        </span>
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
}: {
  count: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between px-2.5 py-2 ">
      <div className="flex items-center gap-2 justify-between w-full">
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          Pull Requests <Badge variant="secondary">{count}</Badge>
          <button
            onClick={onToggleCollapsed}
            className="p-2 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                'size-4 transition-transform duration-200 ease-in-out',
                collapsed ? '-rotate-90' : 'rotate-0'
              )}
            />
          </button>
        </span>
        <Button variant="outline" size="xs">
          <Plus className="size-3" />
          Create PR
        </Button>
      </div>
    </div>
  );
}

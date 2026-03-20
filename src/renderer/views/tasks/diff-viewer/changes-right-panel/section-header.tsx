import { Badge } from '@renderer/components/ui/badge';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { SelectionState } from '../state/use-selection';

interface SectionHeaderProps {
  label: string;
  count: number;
  selectionState: SelectionState;
  onToggleAll: () => void;
  actions?: React.ReactNode;
}

export function SectionHeader({
  label,
  count,
  selectionState,
  onToggleAll,
  actions,
}: SectionHeaderProps) {
  return (
    <div className="shrink-0 flex items-center justify-between px-2.5 py-2 ">
      <div className="flex items-center gap-2 justify-between w-full">
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          {label} <Badge variant="secondary">{count}</Badge>
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

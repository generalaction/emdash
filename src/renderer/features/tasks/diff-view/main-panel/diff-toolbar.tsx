import { AlignJustify, Columns2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import { useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { MicroLabel } from '@renderer/lib/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

interface DiffToolbarProps {
  tab: DiffTabStore;
}

export const DiffToolbar = observer(function DiffToolbar({ tab }: DiffToolbarProps) {
  const diffView = useWorkspaceViewModel().diffView;
  const diffStyle = diffView?.diffStyle;

  const diffSourceLabel = (() => {
    if (tab.diffGroup === 'staged') return 'Staged';
    if (tab.diffGroup === 'disk') return 'Changed';
    if (tab.diffGroup === 'pr') return 'PR';
    if (tab.diffGroup === 'git') return 'Git';
    return undefined;
  })();

  if (!diffView || !diffStyle) return null;

  return (
    <div className="flex h-[41px] items-center gap-2 border-b border-border px-2 justify-between bg-background-secondary-1">
      <div className="flex items-center gap-3">
        {diffSourceLabel && <MicroLabel>{diffSourceLabel}</MicroLabel>}
      </div>
      <div className="flex items-center gap-2">
        <ToggleGroup
          size="sm"
          multiple={false}
          value={[diffStyle]}
          onValueChange={([value]) => {
            if (value) {
              diffView.setDiffStyle(value as 'unified' | 'split');
            }
          }}
        >
          <ToggleGroupItem value="unified">
            <AlignJustify className="h-3.5 w-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem value="split">
            <Columns2 className="h-3.5 w-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
});

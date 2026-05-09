import { AlignJustify, Columns2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { MicroLabel } from '@renderer/lib/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

export const DiffToolbar = observer(function DiffToolbar() {
  const diffView = useProvisionedTask().taskView.diffView;
  const diffStyle = diffView.diffStyle;
  const activeFile = diffView.activeFile;

  const diffSourceLabel = useMemo(() => {
    if (activeFile?.group === 'staged') return 'Staged';
    if (activeFile?.group === 'disk') return 'Changed';
    if (activeFile?.group === 'pr') return 'PR';
    if (activeFile?.group === 'git') return 'Git';
    return undefined;
  }, [activeFile?.group]);

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

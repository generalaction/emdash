import { AlignJustify, Columns2, FileText, Layers } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { FileIcon } from '@renderer/core/editor/file-icon';
import { splitPath } from '@renderer/core/git/utils';
import { useProvisionedTask } from '@renderer/views/tasks/task-view-context';

export const DiffToolbar = observer(function DiffToolbar() {
  const diffView = useProvisionedTask()?.diffView;
  const viewMode = diffView?.viewMode ?? 'stacked';
  const diffStyle = diffView?.diffStyle ?? 'unified';
  const activeFile = diffView?.activeFile ?? null;
  const stackedDiffDisabled = diffView?.stackedDiffDisabled ?? false;

  const filePath = viewMode === 'file' ? (activeFile?.path ?? undefined) : undefined;
  const { filename, directory } = filePath ? splitPath(filePath) : { filename: '', directory: '' };

  const diffSourceLabel = useMemo(() => {
    if (activeFile?.type === 'staged') return 'Staged';
    if (activeFile?.type === 'disk') return 'Changed';
    if (activeFile?.type === 'git') return 'Git';
    return undefined;
  }, [activeFile?.type]);

  return (
    <div className="flex h-[41px] items-center gap-2 border-b border-border px-2 justify-between">
      <div className="flex items-center gap-3">
        {viewMode === 'file' && filePath && (
          <div className="text-sm flex items-center gap-2">
            <span className="flex items-center gap-1">
              <FileIcon filename={filename} size={12} />
              {filename}
            </span>
            <span className="text-foreground-muted text-xs">{directory}</span>
          </div>
        )}
        {diffSourceLabel && <Badge variant="outline">{diffSourceLabel}</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <ToggleGroup
          size="sm"
          multiple={false}
          value={[viewMode]}
          onValueChange={([value]) => {
            if (value) {
              diffView?.setViewMode(value as 'stacked' | 'file');
            }
          }}
        >
          <ToggleGroupItem value="stacked" disabled={stackedDiffDisabled}>
            <Layers className="h-3.5 w-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem value="file">
            <FileText className="h-3.5 w-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          size="sm"
          multiple={false}
          value={[diffStyle]}
          onValueChange={([value]) => {
            if (value) {
              diffView?.setDiffStyle(value as 'unified' | 'split');
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

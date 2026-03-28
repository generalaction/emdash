import { AlignJustify, Columns2, FileText, Layers } from 'lucide-react';
import React, { useMemo } from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { FileIcon } from '@renderer/core/editor/file-icon';
import type { ActiveFile } from '@renderer/core/stores/diff-view-store';
import { splitPath } from '@renderer/views/tasks/diff-viewer/utils';

interface DiffToolbarProps {
  viewMode: 'stacked' | 'file';
  diffSource?: ActiveFile['type'];
  filePath?: string;
  onViewModeChange: (mode: 'stacked' | 'file') => void;
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
}

export const DiffToolbar: React.FC<DiffToolbarProps> = ({
  viewMode,
  diffSource,
  onViewModeChange,
  diffStyle,
  filePath,
  onDiffStyleChange,
}) => {
  const { filename, directory } = filePath ? splitPath(filePath) : { filename: '', directory: '' };

  const diffSourceLabel = useMemo(() => {
    if (diffSource === 'staged') return 'Staged';
    if (diffSource === 'disk') return 'Changed';
    if (diffSource === 'git') return 'Git';
    return undefined;
  }, [diffSource]);

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
              onViewModeChange(value as 'stacked' | 'file');
            }
          }}
        >
          <ToggleGroupItem value="stacked">
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
              onDiffStyleChange(value as 'unified' | 'split');
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
};

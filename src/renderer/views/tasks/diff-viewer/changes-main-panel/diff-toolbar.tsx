import { AlignJustify, Columns2, FileText, Layers } from 'lucide-react';
import React from 'react';
import { FileIcon } from '../changes-panel/file-icon';
import { splitPath } from '../utils';

interface DiffToolbarProps {
  viewMode: 'stacked' | 'file';
  diffSource: string;
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
  const activeClass = 'bg-accent text-foreground';
  const inactiveClass = 'text-muted-foreground hover:text-foreground hover:bg-muted';

  const { filename, directory } = filePath ? splitPath(filePath) : { filename: '', directory: '' };
  return (
    <div className="flex h-9 items-center gap-2 border-b border-border px-3 justify-between">
      <div className="flex items-center gap-3">
        <div className="text-sm text-muted-foreground">{diffSource}</div>
        {viewMode === 'file' && filePath && (
          <div className="text-sm flex items-center gap-2">
            <span className="flex items-center gap-1">
              <FileIcon filename={filename} size={12} />
              {filename}
            </span>
            <span className="text-muted-foreground">{directory}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-md border border-border">
          <button
            className={`flex items-center rounded-l-md px-2 py-1 ${viewMode === 'stacked' ? activeClass : inactiveClass}`}
            onClick={() => onViewModeChange('stacked')}
            title="Stacked view"
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
          <button
            className={`flex items-center rounded-r-md px-2 py-1 ${viewMode === 'file' ? activeClass : inactiveClass}`}
            onClick={() => onViewModeChange('file')}
            title="File view"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center rounded-md border border-border">
          <button
            className={`flex items-center rounded-l-md px-2 py-1 ${diffStyle === 'unified' ? activeClass : inactiveClass}`}
            onClick={() => onDiffStyleChange('unified')}
            title="Unified view"
          >
            <AlignJustify className="h-3.5 w-3.5" />
          </button>
          <button
            className={`flex items-center rounded-r-md px-2 py-1 ${diffStyle === 'split' ? activeClass : inactiveClass}`}
            onClick={() => onDiffStyleChange('split')}
            title="Split view"
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

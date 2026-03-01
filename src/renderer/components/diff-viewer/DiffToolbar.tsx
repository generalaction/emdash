import React from 'react';
import { Layers, FileText, AlignJustify, Columns2 } from 'lucide-react';

interface DiffToolbarProps {
  viewMode: 'stacked' | 'file';
  onViewModeChange: (mode: 'stacked' | 'file') => void;
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
  hideViewModeToggle?: boolean;
  closeButton?: React.ReactNode;
}

export const DiffToolbar: React.FC<DiffToolbarProps> = ({
  viewMode,
  onViewModeChange,
  diffStyle,
  onDiffStyleChange,
  hideViewModeToggle,
  closeButton,
}) => {
  const activeClass = 'bg-accent text-foreground';
  const inactiveClass = 'text-muted-foreground hover:text-foreground hover:bg-muted';

  return (
    <div className="flex h-9 items-center gap-2 border-b border-border px-3">
      {/* Stacked / File toggle */}
      {!hideViewModeToggle && (
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
      )}

      {/* Unified / Split toggle */}
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

      <div className="ml-auto flex items-center gap-2">{closeButton}</div>
    </div>
  );
};

import React, { useEffect, useState, useCallback } from 'react';
import { Layers, FileText, AlignJustify, Columns2, ArrowUp } from 'lucide-react';

interface DiffToolbarProps {
  viewMode: 'stacked' | 'file';
  onViewModeChange: (mode: 'stacked' | 'file') => void;
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
  taskPath?: string;
  onPushComplete?: () => void;
  hideViewModeToggle?: boolean;
  hidePushButton?: boolean;
}

export const DiffToolbar: React.FC<DiffToolbarProps> = ({
  viewMode,
  onViewModeChange,
  diffStyle,
  onDiffStyleChange,
  taskPath,
  onPushComplete,
  hideViewModeToggle,
  hidePushButton,
}) => {
  const [aheadCount, setAheadCount] = useState(0);
  const [isPushing, setIsPushing] = useState(false);

  const fetchBranchStatus = useCallback(async () => {
    if (!taskPath) return;
    try {
      const res = await window.electronAPI.getBranchStatus({ taskPath });
      if (res?.success && typeof res.ahead === 'number') {
        setAheadCount(res.ahead);
      }
    } catch {
      // ignore
    }
  }, [taskPath]);

  useEffect(() => {
    fetchBranchStatus();
  }, [fetchBranchStatus]);

  const handlePush = async () => {
    if (!taskPath || aheadCount === 0 || isPushing) return;
    setIsPushing(true);
    try {
      await window.electronAPI.gitPush({ taskPath });
      await fetchBranchStatus();
      onPushComplete?.();
    } catch {
      // ignore
    } finally {
      setIsPushing(false);
    }
  };

  const activeClass = 'bg-accent text-foreground';
  const inactiveClass = 'text-muted-foreground hover:text-foreground hover:bg-muted';

  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
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

      {/* Push button */}
      {!hidePushButton && (
        <button
          className={`ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            aheadCount === 0 || isPushing
              ? 'cursor-not-allowed text-muted-foreground opacity-50'
              : 'text-foreground hover:bg-muted'
          }`}
          disabled={aheadCount === 0 || isPushing}
          onClick={handlePush}
          title={
            aheadCount > 0
              ? `Push ${aheadCount} commit${aheadCount > 1 ? 's' : ''}`
              : 'No unpushed commits'
          }
        >
          <ArrowUp className="h-3.5 w-3.5" />
          {aheadCount > 0 && <span>{aheadCount}</span>}
        </button>
      )}
    </div>
  );
};

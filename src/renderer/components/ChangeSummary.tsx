import React, { useCallback, useEffect, useState } from 'react';
import { useCreatePR } from '../hooks/useCreatePR';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Close as PopoverClose } from '@radix-ui/react-popover';
import { ChevronDown, FileDiff } from 'lucide-react';
import { dispatchFileChangeEvent, subscribeToFileChanges } from '../lib/fileChangeEvents';
import type { FileChange } from '../hooks/useFileChanges';

type PrMode = 'create' | 'draft';

const PR_MODE_LABELS: Record<PrMode, string> = {
  create: 'Create PR',
  draft: 'Draft PR',
};

interface ChangeSummaryProps {
  taskPath?: string;
  fileChanges: FileChange[];
  onOpenChanges: (filePath?: string) => void;
}

export const ChangeSummary: React.FC<ChangeSummaryProps> = ({
  taskPath,
  fileChanges,
  onOpenChanges,
}) => {
  const { isCreating, createPR } = useCreatePR();
  const [prMode, setPrMode] = useState<PrMode>('draft');
  const [showPrButton, setShowPrButton] = useState(false);

  const fetchBranchStatus = useCallback(async () => {
    if (!taskPath) return;
    try {
      const result = await window.electronAPI.getBranchStatus({ taskPath });
      if (result.success) {
        setShowPrButton((result.aheadOfDefault ?? 0) > 0);
      }
    } catch {
      setShowPrButton(false);
    }
  }, [taskPath]);

  useEffect(() => {
    void fetchBranchStatus();
  }, [fetchBranchStatus]);

  useEffect(() => {
    if (!taskPath) return;
    return subscribeToFileChanges((event) => {
      if (event.detail.taskPath === taskPath) {
        void fetchBranchStatus();
      }
    });
  }, [taskPath, fetchBranchStatus]);

  const totalAdditions = fileChanges.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = fileChanges.reduce((sum, f) => sum + f.deletions, 0);
  const fileCount = fileChanges.length;
  const hasChanges = fileCount > 0;

  const handlePrAction = async () => {
    if (!taskPath) return;
    await createPR({
      taskPath,
      prOptions: {
        draft: prMode === 'draft',
        fill: true,
      },
      onSuccess: () => {
        dispatchFileChangeEvent(taskPath);
      },
    });
  };

  return (
    <div className="bg-muted px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex shrink-0 items-center gap-2">
          {hasChanges && (
            <div className="flex items-center gap-1 text-xs">
              <span className="font-medium text-green-600 dark:text-green-400">
                +{totalAdditions}
              </span>
              <span className="text-muted-foreground">&middot;</span>
              <span className="font-medium text-red-600 dark:text-red-400">-{totalDeletions}</span>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs"
            title="View all changes and history"
            onClick={() => onOpenChanges()}
          >
            <FileDiff className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Changes</span>
          </Button>
          {showPrButton && (
            <div className="flex min-w-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 min-w-0 truncate rounded-r-none border-r-0 px-2 text-xs"
                disabled={isCreating}
                onClick={handlePrAction}
              >
                {isCreating ? <Spinner size="sm" /> : PR_MODE_LABELS[prMode]}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-l-none px-1.5"
                    disabled={isCreating}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto min-w-0 p-0.5">
                  {(['create', 'draft'] as PrMode[])
                    .filter((m) => m !== prMode)
                    .map((m) => (
                      <PopoverClose key={m} asChild>
                        <button
                          className="w-full whitespace-nowrap rounded px-2 py-1 text-left text-xs hover:bg-accent"
                          onClick={() => setPrMode(m)}
                        >
                          {PR_MODE_LABELS[m]}
                        </button>
                      </PopoverClose>
                    ))}
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

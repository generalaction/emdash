import React, { useMemo, useRef, useState } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useTaskScope } from './TaskScopeContext';
import { usePendingInjection } from '../hooks/usePendingInjection';
import { useTaskComments } from '../hooks/useLineComments';
import { formatCommentsForAgent } from '../lib/formatCommentsForAgent';
import type { LineComment } from '../types/electron-api';

interface CommentsPopoverProps {
  taskId?: string;
  children: React.ReactNode;
  tooltipContent?: string;
  tooltipDelay?: number;
  onOpenChange?: (open: boolean) => void;
  onSelectedCountChange?: (count: number) => void;
}

export function CommentsPopover({
  taskId,
  children,
  tooltipContent,
  tooltipDelay = 300,
  onOpenChange,
  onSelectedCountChange,
}: CommentsPopoverProps) {
  const { taskId: scopedTaskId } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId ?? '';
  const { unsentComments, markSent, refresh } = useTaskComments(resolvedTaskId);
  const { setPending, clear, onInjectionUsed } = usePendingInjection();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const pendingIdsRef = useRef<string[]>([]);
  const hasCustomSelectionRef = useRef(false);
  const lastUnsentIdsRef = useRef<Set<string>>(new Set());

  const emitSelectedCount = React.useCallback(
    (next: Set<string>) => {
      onSelectedCountChange?.(next.size);
    },
    [onSelectedCountChange]
  );

  React.useEffect(() => {
    hasCustomSelectionRef.current = false;
    lastUnsentIdsRef.current = new Set();
    pendingIdsRef.current = [];
    setSelectedIds(new Set());
    setOpen(false);
    clear();
    onSelectedCountChange?.(0);
  }, [clear, onSelectedCountChange, resolvedTaskId]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && resolvedTaskId) {
      void refresh();
    }
    onOpenChange?.(nextOpen);
  };

  React.useEffect(() => {
    if (!resolvedTaskId) return;
    const nextIds = new Set(unsentComments.map((comment) => comment.id));
    setSelectedIds((prev) => {
      if (!hasCustomSelectionRef.current) {
        const next = new Set(nextIds);
        emitSelectedCount(next);
        return next;
      }
      const next = new Set(Array.from(prev).filter((id) => nextIds.has(id)));
      for (const id of nextIds) {
        if (!lastUnsentIdsRef.current.has(id)) {
          next.add(id);
        }
      }
      emitSelectedCount(next);
      return next;
    });
    lastUnsentIdsRef.current = nextIds;
  }, [emitSelectedCount, resolvedTaskId, unsentComments]);

  const handleSelectedChange = React.useCallback((next: Set<string>) => {
    hasCustomSelectionRef.current = true;
    setSelectedIds(next);
    emitSelectedCount(next);
  }, [emitSelectedCount]);

  React.useEffect(() => {
    if (!resolvedTaskId) return;
    const selectedComments = unsentComments.filter((comment) => selectedIds.has(comment.id));

    if (selectedComments.length === 0) {
      pendingIdsRef.current = [];
      clear();
      return;
    }

    const formatted = formatCommentsForAgent(selectedComments, {
      includeIntro: false,
      leadingNewline: true,
    });
    if (!formatted) {
      pendingIdsRef.current = [];
      clear();
      return;
    }

    pendingIdsRef.current = selectedComments.map((comment) => comment.id);
    setPending(formatted);
  }, [clear, selectedIds, setPending, unsentComments, resolvedTaskId]);

  React.useEffect(() => {
    return onInjectionUsed(() => {
      const sentIds = pendingIdsRef.current;
      if (sentIds.length === 0) return;
      pendingIdsRef.current = [];
      void markSent(sentIds);
    });
  }, [markSent, onInjectionUsed]);

  const groupedComments = useMemo(() => {
    const groups = new Map<string, LineComment[]>();
    for (const c of unsentComments) {
      const existing = groups.get(c.filePath) ?? [];
      existing.push(c);
      groups.set(c.filePath, existing);
    }
    return groups;
  }, [unsentComments]);

  const allSelected = unsentComments.length > 0 && selectedIds.size === unsentComments.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      handleSelectedChange(new Set());
    } else {
      handleSelectedChange(new Set(unsentComments.map((c) => c.id)));
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {tooltipContent ? (
        <TooltipProvider delayDuration={tooltipDelay}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>{children}</PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {tooltipContent}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent className="w-[min(460px,92vw)] p-0" align="start">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Review comments</span>
            <span className="text-xs text-muted-foreground">
              {unsentComments.length} unsent • {selectedIds.size} selected
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleSelectAll}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
        </div>

        <ScrollArea className="max-h-[360px]">
          <div className="divide-y">
            {Array.from(groupedComments.entries()).map(([filePath, fileComments]) => (
              <div key={filePath} className="py-2">
                <div
                  className="truncate px-4 pb-1 text-xs font-medium text-muted-foreground"
                  title={filePath}
                >
                  {filePath}
                </div>
                <div className="space-y-1">
                  {fileComments.map((comment) => (
                    <label
                      key={comment.id}
                      className="flex cursor-pointer items-start gap-2 px-4 py-2 transition-colors hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={selectedIds.has(comment.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedIds);
                          if (checked === true) {
                            next.add(comment.id);
                          } else {
                            next.delete(comment.id);
                          }
                          handleSelectedChange(next);
                        }}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">
                          Line {comment.lineNumber}
                        </div>
                        <div className="line-clamp-2 break-words text-sm leading-snug">
                          {comment.content}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {unsentComments.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No unsent comments.
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

import React, { useState, useMemo } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface LineComment {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent?: string | null;
  side: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
}

interface CommentsPopoverProps {
  comments: LineComment[];
  selectedIds: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  children: React.ReactNode;
  tooltipContent?: string;
  tooltipDelay?: number;
  onOpenChange?: (open: boolean) => void;
}

export function CommentsPopover({
  comments,
  selectedIds,
  onSelectedChange,
  children,
  tooltipContent,
  tooltipDelay = 300,
  onOpenChange,
}: CommentsPopoverProps) {
  const [open, setOpen] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const groupedComments = useMemo(() => {
    const groups = new Map<string, LineComment[]>();
    for (const c of comments) {
      const existing = groups.get(c.filePath) ?? [];
      existing.push(c);
      groups.set(c.filePath, existing);
    }
    return groups;
  }, [comments]);

  const allSelected = comments.length > 0 && selectedIds.size === comments.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      onSelectedChange(new Set());
    } else {
      onSelectedChange(new Set(comments.map((c) => c.id)));
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
              {comments.length} unsent • {selectedIds.size} selected
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
                          onSelectedChange(next);
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
            {comments.length === 0 && (
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

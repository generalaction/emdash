import React, { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useTaskScope } from './TaskScopeContext';
import { useTaskComments } from '../hooks/useLineComments';
import type { DraftComment } from '../lib/DraftCommentsStore';

interface CommentsPopoverProps {
  taskId?: string;
  children: React.ReactNode;
  tooltipContent?: string;
  tooltipDelay?: number;
  onOpenChange?: (open: boolean) => void;
}

export function CommentsPopover({
  taskId,
  children,
  tooltipContent,
  tooltipDelay = 300,
  onOpenChange,
}: CommentsPopoverProps) {
  const { taskId: scopedTaskId } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId ?? '';
  const { comments, remove } = useTaskComments(resolvedTaskId);

  const groupedComments = useMemo(() => {
    const groups = new Map<string, DraftComment[]>();
    for (const c of comments) {
      const existing = groups.get(c.filePath) ?? [];
      existing.push(c);
      groups.set(c.filePath, existing);
    }
    return groups;
  }, [comments]);

  return (
    <Popover onOpenChange={onOpenChange}>
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
              {comments.length} comment{comments.length !== 1 ? 's' : ''} will be sent with your
              next message
            </span>
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
                    <div
                      key={comment.id}
                      className="flex items-start gap-2 px-4 py-2 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">
                          Line {comment.lineNumber}
                        </div>
                        <div className="line-clamp-2 break-words text-sm leading-snug">
                          {comment.content}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(comment.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {comments.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No comments. Click the + icon in the diff gutter to add one.
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

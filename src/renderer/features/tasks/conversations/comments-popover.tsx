import { ArrowUp, MessageSquare, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import type { DraftComment } from '@renderer/features/tasks/diff-view/stores/draft-comments-store';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

interface CommentsPopoverProps {
  comments: DraftComment[];
  canApplyContext: boolean;
  onApply: () => void | Promise<void>;
  onDelete: (id: string) => void;
}

export const CommentsPopover = observer(function CommentsPopover({
  comments,
  canApplyContext,
  onApply,
  onDelete,
}: CommentsPopoverProps) {
  const [open, setOpen] = useState(false);

  const groupedComments = useMemo(() => {
    const groups = new Map<string, DraftComment[]>();
    for (const comment of comments) {
      const existing = groups.get(comment.filePath) ?? [];
      existing.push(comment);
      groups.set(comment.filePath, existing);
    }
    return groups;
  }, [comments]);

  const count = comments.length;

  const handleApply = () => {
    void onApply();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger className="relative self-center flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-background-1 px-2 text-xs font-normal text-foreground hover:bg-background-1/80">
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-72 truncate">Comments</span>
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-background-3 px-1 text-[10px] font-semibold text-foreground-muted">
              {count}
            </span>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {canApplyContext
            ? `${count} comment${count === 1 ? '' : 's'} pending`
            : 'Create and select a conversation first'}
        </TooltipContent>
      </Tooltip>

      <PopoverContent align="start" className="w-[min(460px,92vw)] gap-0 p-0">
        <div className="border-b px-4 py-3 flex flex-row justify-between items-center">
          <div>
            <div className="text-sm font-semibold">Review comments</div>
            <div className="text-xs text-muted-foreground">
              {count} comment{count === 1 ? '' : 's'} ready to add to the chat input
            </div>
          </div>
          <div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={!canApplyContext || count === 0}
                    onClick={() => void handleApply()}
                    aria-label="Add comments to chat input"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Add comments to chat input
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className="max-h-[min(360px,55vh)] overflow-y-auto">
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
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => onDelete(comment.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});

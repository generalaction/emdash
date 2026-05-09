import { ArrowUp, FileSearch } from 'lucide-react';
import { type ContextAction } from '@renderer/features/tasks/conversations/context-actions';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ProviderLogo } from '../components/issue-selector/issue-selector';

interface ModalContextBarProps {
  actions: ContextAction[];
  onActionClick: (text: string) => void;
}

export function ModalContextBar({ actions, onActionClick }: ModalContextBarProps) {
  if (actions.length === 0) return null;

  const issueAction = actions.find((a) => a.kind === 'linked-issue') ?? null;
  const reviewAction = actions.find((a) => a.kind === 'review-prompt') ?? null;

  return (
    <TooltipProvider>
      <div className="border-t border-border px-2 flex items-center gap-2 h-[41px]">
        {reviewAction ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onActionClick(reviewAction.text)}
                className="h-7 max-w-full rounded-md bg-background-1 px-2 text-xs font-normal hover:bg-background-1/80"
              >
                <FileSearch className="size-3.5 shrink-0" />
                <span className="max-w-72 truncate">{reviewAction.label}</span>
                <ArrowUp className="size-3 shrink-0" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add review prompt to the initial message</TooltipContent>
          </Tooltip>
        ) : null}
        {issueAction ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onActionClick(issueAction.text)}
                className="h-7 max-w-full rounded-md bg-background-1 px-2 text-xs font-normal hover:bg-background-1/80"
              >
                {issueAction.provider ? (
                  <ProviderLogo provider={issueAction.provider} className="h-3.5 w-3.5" />
                ) : null}
                <span className="max-w-72 truncate">{issueAction.label}</span>
                <ArrowUp className="size-3 shrink-0" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add issue context to the initial message</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

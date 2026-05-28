import { ArrowUp, LoaderCircle } from 'lucide-react';
import {
  type ContextAction,
  type PromptContextAction,
} from '@renderer/features/tasks/conversations/context-actions';
import { PromptActionsMenu } from '@renderer/features/tasks/conversations/prompt-actions-menu';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ProviderLogo } from '../components/issue-selector/issue-selector';

interface ModalContextBarProps {
  actions: ContextAction[];
  onActionClick: (action: ContextAction) => void;
  issueActionPending?: boolean;
}

export function ModalContextBar({
  actions,
  onActionClick,
  issueActionPending = false,
}: ModalContextBarProps) {
  if (actions.length === 0) return null;

  const issueAction = actions.find((a) => a.kind === 'linked-issue') ?? null;
  const promptActions = actions.filter((a): a is PromptContextAction => a.kind === 'prompt');

  return (
    <TooltipProvider>
      <div className="flex h-[41px] items-center gap-2 border-t border-border px-2">
        <PromptActionsMenu
          actions={promptActions}
          disabled={false}
          disabledTooltip="Prompt unavailable"
          actionTooltip="Add a prompt to the initial message"
          onActionClick={onActionClick}
        />
        {issueAction ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="outline"
                size="sm"
                disabled={issueActionPending}
                onClick={() => onActionClick(issueAction)}
                className="h-7 max-w-full rounded-md bg-background-1 px-2 text-xs font-normal hover:bg-background-1/80"
              >
                {issueAction.provider ? (
                  <ProviderLogo provider={issueAction.provider} className="h-3.5 w-3.5" />
                ) : null}
                <span className="max-w-72 truncate">
                  {issueActionPending
                    ? 'Adding issue context...'
                    : `${issueAction.issue.identifier} ${issueAction.issue.title}`}
                </span>
                {issueActionPending ? (
                  <LoaderCircle className="size-3 shrink-0 animate-spin" />
                ) : (
                  <ArrowUp className="size-3 shrink-0" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {issueActionPending
                ? 'Adding issue context to the initial message'
                : 'Add issue context to the initial message'}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

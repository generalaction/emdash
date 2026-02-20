import React from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { type LinearIssueSummary } from '../types/linear';
import { type GitHubIssueSummary } from '../types/github';
import { type JiraIssueSummary } from '../types/jira';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { CommentsPopover } from './CommentsPopover';
import { Button } from './ui/button';
import { useTaskComments } from '../hooks/useLineComments';
import { useTaskScope } from './TaskScopeContext';
import linearLogoSvg from '../../assets/images/Linear.svg?raw';
import githubLogo from '../../assets/images/github.png';
import jiraLogo from '../../assets/images/jira.png';
import AgentLogo from './AgentLogo';

type Props = {
  taskId?: string;
  linearIssue?: LinearIssueSummary | null;
  githubIssue?: GitHubIssueSummary | null;
  jiraIssue?: JiraIssueSummary | null;
};

export const TaskContextBadges: React.FC<Props> = ({
  taskId,
  linearIssue,
  githubIssue,
  jiraIssue,
}) => {
  const { taskId: scopedTaskId } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId;
  const { unsentCount } = useTaskComments(resolvedTaskId);
  const [selectedCount, setSelectedCount] = React.useState(0);

  React.useEffect(() => {
    setSelectedCount(0);
  }, [resolvedTaskId]);

  const handleIssueClick = (url?: string) => {
    if (!url) return;
    try {
      window.electronAPI?.openExternal?.(url);
    } catch (e) {
      console.error('Failed to open external link:', e);
    }
  };

  return (
    <div className="inline-flex items-center gap-2">
      {linearIssue && (
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs font-medium text-foreground hover:bg-muted/80 dark:border-border dark:bg-muted dark:hover:bg-muted/80"
                onClick={() => handleIssueClick(linearIssue.url || undefined)}
                aria-label={`Linear issue ${linearIssue.identifier}: ${linearIssue.title || 'No title'}`}
              >
                <AgentLogo
                  logo={linearLogoSvg}
                  alt="Linear"
                  className="h-3.5 w-3.5 text-foreground"
                />
                <span>{linearIssue.identifier}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm">
              <div className="text-xs">
                <div className="mb-1.5 flex min-w-0 items-center gap-2">
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                    <AgentLogo
                      logo={linearLogoSvg}
                      alt="Linear"
                      className="h-3 w-3 text-foreground"
                    />
                    <span className="text-[11px] font-medium">{linearIssue.identifier}</span>
                  </span>
                  {linearIssue.title && (
                    <span className="truncate text-foreground">{linearIssue.title}</span>
                  )}
                </div>
                <div className="space-y-0.5 text-muted-foreground">
                  {linearIssue.state?.name && (
                    <div>
                      <span className="font-medium">State:</span> {linearIssue.state.name}
                    </div>
                  )}
                  {(linearIssue.assignee?.displayName || linearIssue.assignee?.name) && (
                    <div>
                      <span className="font-medium">Assignee:</span>{' '}
                      {linearIssue.assignee.displayName || linearIssue.assignee.name}
                    </div>
                  )}
                  {linearIssue.url && (
                    <div className="mt-1 flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      <span className="text-[11px]">Click to open in Linear</span>
                    </div>
                  )}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {githubIssue && (
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs font-medium text-foreground hover:bg-muted/80 dark:border-border dark:bg-muted dark:hover:bg-muted/80"
                onClick={() => handleIssueClick(githubIssue.url || undefined)}
                aria-label={`GitHub issue #${githubIssue.number}: ${githubIssue.title || 'No title'}`}
              >
                <img src={githubLogo} alt="GitHub" className="h-3.5 w-3.5" />
                <span>#{githubIssue.number}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm">
              <div className="text-xs">
                <div className="mb-1.5 flex min-w-0 items-center gap-2">
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                    <img src={githubLogo} alt="GitHub" className="h-3 w-3" />
                    <span className="text-[11px] font-medium">#{githubIssue.number}</span>
                  </span>
                  {githubIssue.title && (
                    <span className="truncate text-foreground">{githubIssue.title}</span>
                  )}
                </div>
                {githubIssue.url && (
                  <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    <span className="text-[11px]">Click to open on GitHub</span>
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {jiraIssue && (
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs font-medium text-foreground hover:bg-muted/80 dark:border-border dark:bg-muted dark:hover:bg-muted/80"
                onClick={() => handleIssueClick(jiraIssue.url || undefined)}
                aria-label={`Jira issue ${jiraIssue.key}: ${jiraIssue.summary || 'No summary'}`}
              >
                <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                <span>{jiraIssue.key}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm">
              <div className="text-xs">
                <div className="mb-1.5 flex min-w-0 items-center gap-2">
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                    <img src={jiraLogo} alt="Jira" className="h-3 w-3" />
                    <span className="text-[11px] font-medium">{jiraIssue.key}</span>
                  </span>
                  {jiraIssue.summary && (
                    <span className="truncate text-foreground">{jiraIssue.summary}</span>
                  )}
                </div>
                <div className="space-y-0.5 text-muted-foreground">
                  {jiraIssue.status?.name && (
                    <div>
                      <span className="font-medium">Status:</span> {jiraIssue.status.name}
                    </div>
                  )}
                  {(jiraIssue.assignee?.displayName || jiraIssue.assignee?.name) && (
                    <div>
                      <span className="font-medium">Assignee:</span>{' '}
                      {jiraIssue.assignee.displayName || jiraIssue.assignee.name}
                    </div>
                  )}
                  {jiraIssue.url && (
                    <div className="mt-1 flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      <span className="text-[11px]">Click to open in Jira</span>
                    </div>
                  )}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {resolvedTaskId && unsentCount > 0 && (
        <CommentsPopover
          tooltipContent="Selected comments are appended to your next agent message."
          tooltipDelay={300}
          onSelectedCountChange={setSelectedCount}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={[
              'relative h-7 gap-1.5 px-2 text-xs',
              selectedCount > 0
                ? 'border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/15'
                : 'border-border bg-muted hover:bg-muted/80 dark:border-border dark:bg-muted',
            ].join(' ')}
            title={
              selectedCount > 0
                ? `${selectedCount} selected comment${selectedCount === 1 ? '' : 's'} ready to append`
                : 'Review or select comments to append'
            }
          >
            <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="font-medium">Comments</span>
            {selectedCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold text-white">
                {selectedCount}
              </span>
            )}
          </Button>
        </CommentsPopover>
      )}
    </div>
  );
};

export default TaskContextBadges;

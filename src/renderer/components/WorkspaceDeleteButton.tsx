import React, { useMemo } from 'react';
import { Trash } from 'lucide-react';
import { Spinner } from './ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { cn } from '@/lib/utils';
import DeleteRiskSkeleton from './DeleteRiskSkeleton';
import { useDeleteRisks } from '../hooks/useDeleteRisks';

type Props = {
  workspaceName: string;
  workspaceId: string;
  workspacePath: string;
  onConfirm: () => void | Promise<void | boolean>;
  className?: string;
  'aria-label'?: string;
  isDeleting?: boolean;
};

export const WorkspaceDeleteButton: React.FC<Props> = ({
  workspaceName,
  workspaceId,
  workspacePath,
  onConfirm,
  className,
  'aria-label': ariaLabel = 'Delete Task',
  isDeleting = false,
}) => {
  const [open, setOpen] = React.useState(false);
  const [acknowledge, setAcknowledge] = React.useState(false);
  const targets = useMemo(
    () => [{ id: workspaceId, name: workspaceName, path: workspacePath }],
    [workspaceId, workspaceName, workspacePath]
  );
  const { risks, loading, hasData } = useDeleteRisks(targets, open);
  const status = risks[workspaceId] || {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    error: undefined,
  };

  const risky =
    status.staged > 0 ||
    status.unstaged > 0 ||
    status.untracked > 0 ||
    status.ahead > 0 ||
    !!status.error;
  const disableDelete: boolean =
    Boolean(isDeleting || loading) || (risky && !acknowledge);

  React.useEffect(() => {
    if (!open) {
      setAcknowledge(false);
    }
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className={cn(
                  className ||
                    'inline-flex items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800',
                  isDeleting && 'opacity-100'
                )}
                title="Delete Task"
                aria-label={ariaLabel}
                aria-busy={isDeleting}
                disabled={isDeleting}
                onClick={(e) => e.stopPropagation()}
              >
                {isDeleting ? (
                  <Spinner className="h-3.5 w-3.5" size="sm" />
                ) : (
                  <Trash className="h-3.5 w-3.5" />
                )}
              </button>
            </AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Delete Task
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AlertDialogContent onClick={(e) => e.stopPropagation()} className="space-y-4">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete task?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this task and its worktree.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-sm">
          {risky ? (
            <div className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50">
              <p className="font-medium">Unmerged or unpushed work detected</p>
              <div className="flex items-center gap-2 rounded-md bg-amber-50/80 px-2 py-1 text-amber-900 dark:bg-amber-500/10 dark:text-amber-50">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-4 w-4 text-amber-700 dark:text-amber-200"
                  aria-hidden="true"
                >
                  <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
                </svg>
                <span className="font-medium">{workspaceName}</span>
                <span className="text-muted-foreground">—</span>
                <span>
                  {[
                    status.staged > 0 ? `${status.staged} ${status.staged === 1 ? 'file' : 'files'} staged` : null,
                    status.unstaged > 0 ? `${status.unstaged} ${status.unstaged === 1 ? 'file' : 'files'} unstaged` : null,
                    status.untracked > 0 ? `${status.untracked} ${status.untracked === 1 ? 'file' : 'files'} untracked` : null,
                    status.ahead > 0 ? `ahead by ${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'}` : null,
                    status.behind > 0 ? `behind by ${status.behind} ${status.behind === 1 ? 'commit' : 'commits'}` : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || status.error || 'Status unavailable'}
                </span>
              </div>
            </div>
          ) : null}
          {risky ? (
            <label className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />
              <span className="leading-tight text-sm text-foreground">
                I understand this workspace has unmerged changes or unpushed commits and want to delete it
                anyway.
              </span>
            </label>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
            disabled={disableDelete}
            onClick={async (e) => {
              e.stopPropagation();
              setOpen(false);
              try {
                await onConfirm();
              } catch {}
            }}
          >
            {isDeleting ? <Spinner className="mr-2 h-4 w-4" size="sm" /> : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default WorkspaceDeleteButton;

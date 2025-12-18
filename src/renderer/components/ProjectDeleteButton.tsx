import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash, Folder } from 'lucide-react';
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
import { useDeleteRisks } from '../hooks/useDeleteRisks';
import DeletePrNotice from './DeletePrNotice';
import { isActivePr } from '../lib/prStatus';
import type { Task } from '../types/chat';

type Props = {
  projectName: string;
  tasks?: Task[];
  onConfirm: () => void | Promise<void>;
  className?: string;
  'aria-label'?: string;
  isDeleting?: boolean;
};

export const ProjectDeleteButton: React.FC<Props> = ({
  projectName,
  tasks = [],
  onConfirm,
  className,
  'aria-label': ariaLabel = 'Delete project',
  isDeleting = false,
}) => {
  const [open, setOpen] = React.useState(false);
  const [acknowledge, setAcknowledge] = React.useState(false);

  const targets = useMemo(
    () => tasks.map((ws) => ({ id: ws.id, name: ws.name, path: ws.path })),
    [tasks]
  );

  const { risks, loading, hasData } = useDeleteRisks(targets, open);

  // Tasks with uncommitted/unpushed changes BUT NO PR
  const tasksWithUncommittedWork = tasks.filter((ws) => {
    const status = risks[ws.id];
    if (!status) return false;
    const hasUncommittedWork =
      status.staged > 0 || status.unstaged > 0 || status.untracked > 0 || status.ahead > 0;
    const hasPR = status.pr && isActivePr(status.pr);
    // Only show in this section if has uncommitted work BUT NO PR
    return hasUncommittedWork && !hasPR;
  });

  // Tasks with PRs (may or may not have uncommitted work)
  const tasksWithPRs = tasks.filter((ws) => {
    const status = risks[ws.id];
    return status?.pr && isActivePr(status.pr);
  });

  const hasRisks = tasksWithUncommittedWork.length > 0 || tasksWithPRs.length > 0;
  const disableDelete = Boolean(isDeleting || loading) || (hasRisks && !acknowledge);

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
                title="Delete project"
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
            Delete project
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AlertDialogContent onClick={(e) => e.stopPropagation()} className="space-y-4">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project?</AlertDialogTitle>
          <AlertDialogDescription>
            {`This removes "${projectName}" from Emdash, including its saved tasks and conversations. Files on disk are not deleted.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          <AnimatePresence initial={false}>
            {loading ? (
              <motion.div
                key="project-delete-loading"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/30 px-4 py-4"
              >
                <Spinner className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" size="sm" />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-semibold text-foreground">Please wait...</span>
                  <span className="text-xs text-muted-foreground">
                    Scanning tasks for uncommitted changes and open pull requests
                  </span>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {!loading && tasksWithUncommittedWork.length > 0 ? (
              <motion.div
                key="project-delete-risk"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50"
              >
                <p className="font-medium">
                  {tasksWithUncommittedWork.length === 1
                    ? 'Unmerged or unpushed work detected in 1 task'
                    : `Unmerged or unpushed work detected in ${tasksWithUncommittedWork.length} tasks`}
                </p>
                <ul className="space-y-1.5">
                  {tasksWithUncommittedWork.map((ws) => {
                    const status = risks[ws.id];
                    if (!status) return null;
                    const summary = [
                      status.staged > 0
                        ? `${status.staged} ${status.staged === 1 ? 'file' : 'files'} staged`
                        : null,
                      status.unstaged > 0
                        ? `${status.unstaged} ${status.unstaged === 1 ? 'file' : 'files'} unstaged`
                        : null,
                      status.untracked > 0
                        ? `${status.untracked} ${status.untracked === 1 ? 'file' : 'files'} untracked`
                        : null,
                      status.ahead > 0
                        ? `ahead by ${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(', ');

                    return (
                      <li
                        key={ws.id}
                        className="flex items-center gap-2 rounded-md bg-amber-50/80 px-2 py-1 text-amber-900 dark:bg-amber-500/10 dark:text-amber-50"
                      >
                        <Folder className="h-4 w-4 fill-amber-700 text-amber-700" />
                        <span className="font-medium">{ws.name}</span>
                        <span className="text-muted-foreground">—</span>
                        <span className="text-sm">{summary}</span>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {!loading && tasksWithPRs.length > 0 ? (
              <motion.div
                key="project-delete-prs"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.18, ease: 'easeOut', delay: 0.02 }}
              >
                <DeletePrNotice
                  tasks={
                    tasksWithPRs
                      .map((ws) => {
                        const pr = risks[ws.id]?.pr;
                        return pr && isActivePr(pr) ? { name: ws.name, pr } : null;
                      })
                      .filter(
                        (w): w is { name: string; pr: NonNullable<typeof w>['pr'] } => w !== null
                      ) as any
                  }
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {hasRisks ? (
              <motion.label
                key="ack-project-delete"
                className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.18, ease: 'easeOut', delay: 0.02 }}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                />
                <span className="text-sm leading-tight text-foreground">Delete project anyway</span>
              </motion.label>
            ) : null}
          </AnimatePresence>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
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
              </TooltipTrigger>
              {disableDelete && !isDeleting ? (
                <TooltipContent side="top" className="text-xs">
                  {loading
                    ? 'Checking tasks...'
                    : hasRisks && !acknowledge
                      ? 'Acknowledge the risks to delete'
                      : 'Delete is disabled'}
                </TooltipContent>
              ) : null}
            </Tooltip>
          </TooltipProvider>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ProjectDeleteButton;

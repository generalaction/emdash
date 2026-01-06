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
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useDeleteRisks } from '../hooks/useDeleteRisks';
import DeletePrNotice from './DeletePrNotice';
import { isActivePr } from '../lib/prStatus';

type Props = {
  taskName: string;
  taskId: string;
  taskPath: string;
  onConfirm: () => void | Promise<void | boolean>;
  className?: string;
  'aria-label'?: string;
  isDeleting?: boolean;
};

export const TaskDeleteButton: React.FC<Props> = ({
  taskName,
  taskId,
  taskPath,
  onConfirm,
  className,
  'aria-label': ariaLabel = 'Delete Task',
  isDeleting = false,
}) => {
  const [open, setOpen] = React.useState(false);
  const [acknowledge, setAcknowledge] = React.useState(false);
  const targets = useMemo(
    () => [{ id: taskId, name: taskName, path: taskPath }],
    [taskId, taskName, taskPath]
  );
  const { risks, loading, hasData } = useDeleteRisks(targets, open);
  const status = risks[taskId] || {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    error: undefined,
    pr: null,
  };

  const risky: boolean =
    status.staged > 0 ||
    status.unstaged > 0 ||
    status.untracked > 0 ||
    status.ahead > 0 ||
    !!status.error ||
    !!(status.pr && isActivePr(status.pr));
  const disableDelete: boolean = Boolean(isDeleting || loading) || (risky && !acknowledge);

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
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(className, isDeleting && 'opacity-100')}
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
              </Button>
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
          <AnimatePresence initial={false}>
            {loading ? (
              <motion.div
                key="task-delete-loading"
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
                    Scanning task for uncommitted changes and open pull requests
                  </span>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {risky && !loading ? (
              <motion.div
                key="delete-risk"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50"
              >
                <p className="font-medium">Unmerged or unpushed work detected</p>
                <div className="flex items-center gap-2 rounded-md bg-amber-50/80 px-2 py-1 text-amber-900 dark:bg-amber-500/10 dark:text-amber-50">
                  <Folder className="h-4 w-4 fill-amber-700 text-amber-700" />
                  <span className="font-medium">{taskName}</span>
                  <span className="text-muted-foreground">—</span>
                  <span>
                    {[
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
                      status.behind > 0
                        ? `behind by ${status.behind} ${status.behind === 1 ? 'commit' : 'commits'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(', ') ||
                      status.error ||
                      'Status unavailable'}
                  </span>
                </div>
                {status.pr && isActivePr(status.pr) ? (
                  <DeletePrNotice tasks={[{ name: taskName, pr: status.pr }]} />
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {risky && !loading ? (
              <motion.label
                key="ack-delete"
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
                <span className="text-sm leading-tight text-foreground">Delete task anyway</span>
              </motion.label>
            ) : null}
          </AnimatePresence>
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

export default TaskDeleteButton;

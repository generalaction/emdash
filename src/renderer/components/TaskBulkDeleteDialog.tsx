import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Folder } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Checkbox } from './ui/checkbox';
import DeletePrNotice from './DeletePrNotice';
import { useDeleteRisks } from '../hooks/useDeleteRisks';
import { isActivePr, type PrInfo } from '../lib/prStatus';

type TaskTarget = {
  id: string;
  name: string;
  path: string;
};

type TaskBulkDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskTarget[];
  onConfirm: () => void | Promise<void | boolean>;
  isDeleting?: boolean;
};

const TaskBulkDeleteDialog: React.FC<TaskBulkDeleteDialogProps> = ({
  open,
  onOpenChange,
  tasks,
  onConfirm,
  isDeleting = false,
}) => {
  const [acknowledgeDirtyDelete, setAcknowledgeDirtyDelete] = React.useState(false);
  const { risks, loading: deleteStatusLoading, summary: deleteRisks } = useDeleteRisks(tasks, open);

  React.useEffect(() => {
    if (!open) {
      setAcknowledgeDirtyDelete(false);
    }
  }, [open]);

  const deleteDisabled: boolean =
    tasks.length === 0 ||
    Boolean(isDeleting || deleteStatusLoading) ||
    (deleteRisks.riskyIds.size > 0 && acknowledgeDirtyDelete !== true);

  const tasksWithUncommittedWorkOnly = tasks.filter((task) => {
    const summary = deleteRisks.summaries[task.id];
    const status = risks[task.id];
    if (!summary && !status?.error) return false;
    if (status?.pr && isActivePr(status.pr)) return false;
    return true;
  });

  const prTasks = tasks
    .map((task) => ({ name: task.name, pr: risks[task.id]?.pr }))
    .filter((task): task is { name: string; pr: PrInfo } => Boolean(task.pr && isActivePr(task.pr)));

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete tasks?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the selected tasks and their worktrees.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {tasksWithUncommittedWorkOnly.length > 0 ? (
              <motion.div
                key="bulk-risk"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50"
              >
                <p className="font-medium">Unmerged or unpushed work detected</p>
                <ul className="space-y-1">
                  {tasksWithUncommittedWorkOnly.map((task) => {
                    const summary = deleteRisks.summaries[task.id];
                    const status = risks[task.id];
                    return (
                      <li
                        key={task.id}
                        className="flex items-center gap-2 rounded-md bg-amber-50/80 px-2 py-1 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-50"
                      >
                        <Folder className="h-4 w-4 fill-amber-700 text-amber-700" />
                        <span className="font-medium">{task.name}</span>
                        <span className="text-muted-foreground">—</span>
                        <span>{summary || status?.error || 'Status unavailable'}</span>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {prTasks.length ? (
              <motion.div
                key="bulk-pr-notice"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.2, ease: 'easeOut', delay: 0.02 }}
              >
                <DeletePrNotice tasks={prTasks} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {deleteRisks.riskyIds.size > 0 ? (
              <motion.label
                key="bulk-ack"
                className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.18, ease: 'easeOut', delay: 0.03 }}
              >
                <Checkbox
                  id="ack-delete"
                  checked={acknowledgeDirtyDelete}
                  onCheckedChange={(val) => setAcknowledgeDirtyDelete(val === true)}
                />
                <span className="leading-tight">Delete tasks anyway</span>
              </motion.label>
            ) : null}
          </AnimatePresence>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive px-4 text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              onOpenChange(false);
              void onConfirm();
            }}
            disabled={deleteDisabled}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default TaskBulkDeleteDialog;

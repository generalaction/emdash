import React, { useState } from 'react';
import { Trash, AlertTriangle } from 'lucide-react';
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

type Props = {
  workspaceName: string;
  workspacePath?: string;
  workspaceBranch?: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  'aria-label'?: string;
  isDeleting?: boolean;
};

export const WorkspaceDeleteButton: React.FC<Props> = ({
  workspaceName,
  workspacePath,
  workspaceBranch,
  onConfirm,
  className,
  'aria-label': ariaLabel = 'Delete workspace',
  isDeleting = false,
}) => {
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false);
  const [hasUnpushedCommits, setHasUnpushedCommits] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const handleDeleteClick = async () => {
    if (workspacePath) {
      setIsCheckingStatus(true);
      try {
        const result = await window.electronAPI.worktreeHasUncommittedChanges({
          worktreePath: workspacePath,
          branch: workspaceBranch,
        });
        if (result.success && result.result) {
          setHasUncommittedChanges(result.result.hasChanges);
          setHasUnpushedCommits(result.result.hasUnpushedCommits);
        }
      } catch (error) {
        console.error('Failed to check workspace status:', error);
      } finally {
        setIsCheckingStatus(false);
      }
    }
    setShowDialog(true);
  };

  const getWarningMessage = () => {
    if (hasUncommittedChanges && hasUnpushedCommits) {
      return `This workspace has uncommitted changes and unpushed commits. Deleting "${workspaceName}" will permanently lose all changes.`;
    } else if (hasUncommittedChanges) {
      return `This workspace has uncommitted changes. Deleting "${workspaceName}" will permanently lose these changes.`;
    } else if (hasUnpushedCommits) {
      return `This workspace has unpushed commits. Deleting "${workspaceName}" will remove the worktree and delete its branch.`;
    }
    return `This will remove the worktree for "${workspaceName}" and delete its branch.`;
  };

  return (
    <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={
                className ||
                'inline-flex items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800'
              }
              title="Delete workspace"
              aria-label={ariaLabel}
              aria-busy={isDeleting || isCheckingStatus}
              disabled={isDeleting || isCheckingStatus}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteClick();
              }}
            >
              {isDeleting || isCheckingStatus ? (
                <Spinner className="h-3.5 w-3.5" size="sm" />
              ) : (
                <Trash className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Delete workspace
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AlertDialogContent onClick={(e) => e.stopPropagation()} className="space-y-4">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {(hasUncommittedChanges || hasUnpushedCommits) && (
              <AlertTriangle className="h-5 w-5 text-orange-500" />
            )}
            Delete workspace?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {getWarningMessage()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await onConfirm();
                setShowDialog(false);
              } catch {}
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default WorkspaceDeleteButton;

import React from 'react';
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

type Props = {
  workspaceName: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  'aria-label'?: string;
  isDeleting?: boolean;
};

export const WorkspaceDeleteButton: React.FC<Props> = ({
  workspaceName,
  onConfirm,
  className,
  'aria-label': ariaLabel = 'Delete workspace',
  isDeleting = false,
}) => {
  return (
    <AlertDialog>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className={
                  className ||
                  'inline-flex items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800'
                }
                title="Delete workspace"
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
            Delete workspace
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AlertDialogContent onClick={(e) => e.stopPropagation()} className="space-y-4">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
          <AlertDialogDescription>
            {`This will remove the worktree for "${workspaceName}" and delete its branch.`}
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

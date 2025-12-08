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
import { cn } from '@/lib/utils';

type Props = {
  projectName: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  'aria-label'?: string;
  isDeleting?: boolean;
};

export const ProjectDeleteButton: React.FC<Props> = ({
  projectName,
  onConfirm,
  className,
  'aria-label': ariaLabel = 'Delete project',
  isDeleting = false,
}) => {
  const [open, setOpen] = React.useState(false);
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
            {`This removes "${projectName}" from emdash, including its saved workspaces and conversations. Files on disk are not deleted.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
            disabled={isDeleting}
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

export default ProjectDeleteButton;

import React from 'react';
import { Spinner } from './ui/spinner';
import { cn } from '@/lib/utils';

interface TaskCreationLoadingProps {
  className?: string;
  logs?: string[];
  status?: 'creating' | 'error';
}

const TaskCreationLoading: React.FC<TaskCreationLoadingProps> = ({
  className,
  logs = [],
  status = 'creating',
}) => {
  const isError = status === 'error';

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3 p-4', className)}>
      <div className="flex items-center gap-2">
        {!isError && <Spinner size="lg" />}
        <p className="text-sm text-muted-foreground">
          {isError ? 'Task setup failed' : 'Creating worktree in background...'}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-3">
        <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {logs.length > 0
            ? logs.join('')
            : isError
              ? 'No output captured. You can delete the task and retry.'
              : 'Waiting for git output...'}
        </pre>
      </div>
    </div>
  );
};

export default TaskCreationLoading;

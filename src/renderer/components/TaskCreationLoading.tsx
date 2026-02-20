import React from 'react';
import { Spinner } from './ui/spinner';
import { cn } from '@/lib/utils';

interface TaskCreationLoadingProps {
  className?: string;
}

const TaskCreationLoading: React.FC<TaskCreationLoadingProps> = ({ className }) => {
  return (
    <div
      className={cn('flex h-full min-h-0 flex-col items-center justify-center gap-3', className)}
    >
      <Spinner size="lg" />
      <p className="text-sm text-muted-foreground">Creating task...</p>
    </div>
  );
};

export default TaskCreationLoading;

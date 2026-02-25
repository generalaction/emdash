import React from 'react';
import { useFileChanges } from '../hooks/useFileChanges';

interface ChangeSummaryProps {
  taskPath?: string;
  onOpenChanges: () => void;
}

export const ChangeSummary: React.FC<ChangeSummaryProps> = ({ taskPath, onOpenChanges }) => {
  const { fileChanges } = useFileChanges(taskPath);

  const totalAdditions = fileChanges.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = fileChanges.reduce((sum, f) => sum + f.deletions, 0);
  const fileCount = fileChanges.length;

  if (fileCount === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-sm font-medium">
        <span className="text-green-500">+{totalAdditions}</span>{' '}
        <span className="text-red-500">-{totalDeletions}</span>
      </span>
      <button
        onClick={onOpenChanges}
        className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        Changes
      </button>
    </div>
  );
};

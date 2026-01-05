import React from 'react';

interface ChangesBadgeProps {
  additions: number;
  deletions: number;
  className?: string;
}

export const ChangesBadge: React.FC<ChangesBadgeProps> = ({
  additions,
  deletions,
  className = '',
}) => {
  if (additions === 0 && deletions === 0) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center rounded px-1 text-xs font-medium text-foreground dark:bg-muted dark:text-muted-foreground ${className}`}
    >
      {additions > 0 && (
        <span className="mr-1 text-green-600 dark:text-green-400">+{additions}</span>
      )}
      {deletions > 0 && <span className="text-red-600 dark:text-red-400">-{deletions}</span>}
    </div>
  );
};

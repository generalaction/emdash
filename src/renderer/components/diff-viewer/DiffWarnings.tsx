import React from 'react';
import type { DiffLineEnding, DiffWarning } from '@shared/diff/types';

interface DiffWarningsProps {
  warnings?: DiffWarning[];
}

function formatLineEnding(value: DiffLineEnding): string {
  if (value === 'none') return 'none';
  if (value === 'crlf') return 'CRLF';
  if (value === 'lf') return 'LF';
  if (value === 'cr') return 'CR';
  return 'mixed';
}

export const DiffWarnings: React.FC<DiffWarningsProps> = ({ warnings }) => {
  if (!warnings || warnings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 border-b border-border bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      {warnings.map((warning, index) => {
        if (warning.kind === 'hidden-bidi') {
          return (
            <div key={`hidden-bidi-${index}`}>
              This diff contains hidden bidirectional Unicode characters.
            </div>
          );
        }

        return (
          <div key={`line-endings-change-${index}`}>
            Line endings changed from {formatLineEnding(warning.from)} to{' '}
            {formatLineEnding(warning.to)}.
          </div>
        );
      })}
    </div>
  );
};

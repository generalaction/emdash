import React from 'react';
import type { LinearStateRef } from '../types/linear';

export const LinearStatusPill: React.FC<{ state?: LinearStateRef | null }> = ({ state }) => {
  if (!state?.name) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      {state.color && (
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: state.color }}
        />
      )}
      {state.name}
    </span>
  );
};

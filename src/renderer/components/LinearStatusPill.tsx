import React from 'react';
import type { LinearStateRef } from '../types/linear';

const getStatusColor = (type?: string | null) => {
  switch (type) {
    case 'completed':
    case 'done':
      return 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200';
    case 'canceled':
    case 'cancelled':
      return 'bg-rose-100/70 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200';
    case 'started':
    case 'in-progress':
      return 'bg-blue-100/70 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200';
    default:
      return 'bg-slate-100/70 text-slate-800 dark:bg-slate-500/10 dark:text-slate-200';
  }
};

export const LinearStatusPill: React.FC<{ state?: LinearStateRef | null }> = ({ state }) => {
  if (!state?.name) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] ${getStatusColor(state.type)}`}
    >
      {state.name}
    </span>
  );
};

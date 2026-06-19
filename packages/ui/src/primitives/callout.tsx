import * as React from 'react';
import { cn } from '../lib/cn';
import type { SurfaceStatusName } from '../theme/contract/roles';
import { Surface } from './surface';

export interface CalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Status variant — determines the tinted background, border, and text color. */
  status: SurfaceStatusName;
  /** Icon rendered before the content (e.g. a Lucide icon). */
  icon?: React.ReactNode;
}

/**
 * Callout — a tinted status "room" for informational messages, warnings, and errors.
 *
 * Uses the status surface cascade, so any ghost Button / Toggle inside adapts
 * automatically. Text defaults to the status foreground via the scope class.
 *
 * Usage:
 *   <Callout status="info" icon={<InfoIcon />}>Something to note.</Callout>
 *   <Callout status="destructive">This action cannot be undone.</Callout>
 */
export function Callout({ status, icon, className, children, ...props }: CalloutProps) {
  return (
    <Surface
      status={status}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        'bg-surface border-surface-border text-surface-foreground',
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="mt-0.5 shrink-0 [&_svg:not([class*='size-'])]:size-4">{icon}</span>
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </Surface>
  );
}

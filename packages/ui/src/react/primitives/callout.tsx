import type { SurfaceStatusName } from '@theme/core/contract/roles';
import * as React from 'react';
import { cx } from '@styles/utilities/cx';
import { Surface } from './surface';
import * as styles from './callout.css';

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
    <Surface status={status} className={cx(styles.calloutRoot, className)} {...props}>
      {icon && <span className={styles.calloutIcon}>{icon}</span>}
      <div className={styles.calloutContent}>{children}</div>
    </Surface>
  );
}

import { cx } from '@styles/index';
import * as React from 'react';
import * as styles from './pill.css';

export type PillTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export interface PillProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Semantic status intent. */
  tone?: PillTone;
  /** Show a leading status dot. */
  dot?: boolean;
  /** Pulse the leading dot (useful for pending/initializing states). */
  pulsing?: boolean;
  /** Truncates long content within the available inline size. */
  truncate?: boolean;
  children: React.ReactNode;
}

/**
 * Compact semantic status label.
 *
 * `className` and remaining span attributes are applied to the rendered pill
 * root. Tone, dot animation, and optional content truncation remain owned by
 * this component.
 */
function Pill({
  tone = 'neutral',
  dot = false,
  pulsing = false,
  truncate = false,
  children,
  className,
  ...props
}: PillProps) {
  return (
    <span {...props} data-tone={tone} className={cx(styles.root({ tone, truncate }), className)}>
      {dot && <span className={cx(styles.dot, pulsing && styles.pulsingDot)} aria-hidden="true" />}
      <span className={styles.label({ truncate })}>{children}</span>
    </span>
  );
}

export { Pill };

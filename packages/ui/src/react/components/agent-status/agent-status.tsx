import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import * as styles from './agent-status.css';

export type AgentStatusKind = 'working' | 'user-action-required' | 'done' | 'error';

export interface AgentStatusProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: AgentStatusKind;
  /**
   * Uniform size shorthand. Sets the shared status bounding box.
   * Numbers are treated as CSS px values.
   */
  size?: string | number;
}

const STATUS_LABELS: Record<AgentStatusKind, string> = {
  working: 'Working',
  'user-action-required': 'User Action Required',
  done: 'Done',
  error: 'Error',
};

const DOT_POINTS = [
  [6, 6],
  [12, 6],
  [18, 6],
  [6, 12],
  [12, 12],
  [18, 12],
  [6, 18],
  [12, 18],
  [18, 18],
] as const;

function toCssLength(size: string | number) {
  return typeof size === 'number' ? `${size}px` : size;
}

function AgentStatus({
  status,
  size = '1.5rem',
  className,
  style,
  role = 'img',
  'aria-label': ariaLabel,
  ...props
}: AgentStatusProps) {
  return (
    <span
      {...props}
      role={role}
      aria-label={ariaLabel ?? STATUS_LABELS[status]}
      data-status={status}
      className={cx(styles.root, className)}
      style={
        {
          '--agent-status-size': toCssLength(size),
          ...style,
        } as React.CSSProperties
      }
    >
      <AgentStatusGlyph status={status} />
    </span>
  );
}

function AgentStatusGlyph({ status }: { status: AgentStatusKind }) {
  switch (status) {
    case 'working':
      return (
        <svg className={cx(styles.icon, styles.workingIcon)} viewBox="0 0 24 24" aria-hidden="true">
          {DOT_POINTS.map(([cx, cy], index) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.85" className={styles.dot[index]} />
          ))}
        </svg>
      );

    case 'user-action-required':
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="6"
            y="6"
            width="12"
            height="12"
            rx="1"
            className={styles.warningShape}
            strokeWidth="1"
            transform="rotate(45 12 12)"
          />
        </svg>
      );

    case 'done':
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7.5" className={styles.successShape} strokeWidth="1" />
        </svg>
      );

    case 'error':
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="5"
            y="5"
            width="16"
            height="16"
            rx="1.5"
            className={styles.errorShape}
            strokeWidth="1"
          />
          <circle cx="13" cy="13" r="0.9" className={styles.errorMark} stroke="none" />
        </svg>
      );
  }
}

export { AgentStatus };

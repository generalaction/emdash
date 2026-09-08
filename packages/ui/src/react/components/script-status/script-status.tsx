import { cx } from '@styles/index';
import { CheckIcon, MinusIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { Icon, type StaticSvgComponent } from '../../primitives/icon';
import * as styles from './script-status.css';

export type ScriptStatusKind = 'success' | 'error' | 'in-progress' | 'waiting' | 'cancelled';

export interface ScriptStatusProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: ScriptStatusKind;
  /**
   * Uniform size shorthand. Sets the shared status bounding box.
   * Numbers are treated as CSS px values.
   */
  size?: string | number;
}

const STATUS_LABELS: Record<ScriptStatusKind, string> = {
  success: 'Success',
  error: 'Error',
  'in-progress': 'In Progress',
  waiting: 'Waiting',
  cancelled: 'Cancelled',
};

// Clockwise animation order for a matrix laid out as:
// [1, 2]
// [3, 4]
// The pulse therefore travels 1 → 2 → 4 → 3 → 1.
const DOT_POINTS = [
  [7.5, 7.5],
  [16.5, 7.5],
  [16.5, 16.5],
  [7.5, 16.5],
] as const;

const STATUS_ICONS: Record<ScriptStatusKind, StaticSvgComponent> = {
  success: CheckIcon,
  error: XIcon,
  'in-progress': InProgressStatusIcon,
  waiting: WaitingStatusIcon,
  cancelled: MinusIcon,
};

function toCssLength(size: string | number) {
  return typeof size === 'number' ? `${size}px` : size;
}

/**
 * Renders an accessible script-state graphic through the owned `Icon` contract.
 * The semantic status Recipe and caller `className` are applied to the span root.
 */
function ScriptStatus({
  status,
  size = '1.5rem',
  className,
  style,
  role = 'img',
  'aria-label': ariaLabel,
  ...props
}: ScriptStatusProps) {
  return (
    <span
      {...props}
      role={role}
      aria-label={ariaLabel ?? STATUS_LABELS[status]}
      data-status={status}
      className={cx(styles.scriptStatus({ status }), className)}
      style={
        {
          '--_script-status-size': toCssLength(size),
          ...style,
        } as React.CSSProperties
      }
    >
      <Icon source={STATUS_ICONS[status]} strokeWidth={2} />
    </span>
  );
}

function InProgressStatusIcon(props: React.ComponentPropsWithRef<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      {DOT_POINTS.map(([cx, cy], index) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" className={styles.dot[index]} />
      ))}
    </svg>
  );
}

function WaitingStatusIcon(props: React.ComponentPropsWithRef<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

export { ScriptStatus };

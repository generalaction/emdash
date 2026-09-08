import { cx } from '@styles/index';
import * as React from 'react';
import { Icon } from '../../primitives/icon';
import * as styles from './machine-status.css';

export type MachineStatusKind = 'idle' | 'successful' | 'error' | 'initializing';

export interface MachineStatusProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'children'
> {
  status: MachineStatusKind;
  /**
   * Uniform size shorthand. Sets the shared machine status bounding box.
   * Numbers are treated as CSS px values.
   */
  size?: string | number;
}

const STATUS_LABELS: Record<MachineStatusKind, string> = {
  idle: 'Idle',
  successful: 'Connected',
  error: 'Error',
  initializing: 'Initializing',
};

function toCssLength(size: string | number) {
  return typeof size === 'number' ? `${size}px` : size;
}

/**
 * Renders an accessible machine-state graphic through the owned `Icon` contract.
 * The semantic status Recipe and caller `className` are applied to the span root.
 */
function MachineStatus({
  status,
  size = '1.5rem',
  className,
  style,
  role = 'img',
  'aria-label': ariaLabel,
  ...props
}: MachineStatusProps) {
  return (
    <span
      {...props}
      role={role}
      aria-label={ariaLabel ?? STATUS_LABELS[status]}
      data-status={status}
      className={cx(styles.machineStatus({ status }), className)}
      style={
        {
          '--_machine-status-size': toCssLength(size),
          ...style,
        } as React.CSSProperties
      }
    >
      <Icon source={MachineStatusGlyph} />
    </span>
  );
}

function MachineStatusGlyph(props: React.ComponentPropsWithRef<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect x="2" y="2" width="20" height="9.5" rx="3" className={styles.backgroundSegment} />
      <rect x="2" y="12.5" width="20" height="9.5" rx="3" className={styles.backgroundSegment} />
      <circle cx="7" cy="7" r="1" className={styles.dot} />
      <circle cx="7" cy="17.5" r="1" className={styles.dot} />
      <circle cx="20" cy="20" r="4" className={styles.statusDot} />
    </svg>
  );
}

export { MachineStatus };

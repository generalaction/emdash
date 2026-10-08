import { Meter as MeterPrimitive } from '@base-ui/react/meter';
import { cx } from '@styles/utilities/cx';
import type { ReactNode } from 'react';
import * as styles from './meter.css';

export interface MeterProps extends Omit<MeterPrimitive.Root.Props, 'className' | 'children'> {
  label: string;
  startLabel?: ReactNode;
  endLabel?: ReactNode;
  className?: string;
}

export function Meter({ label, startLabel, endLabel, className, ...props }: MeterProps) {
  return (
    <MeterPrimitive.Root {...props} aria-label={label} className={cx(styles.root, className)}>
      <MeterPrimitive.Track className={styles.track}>
        <MeterPrimitive.Indicator className={styles.indicator} />
      </MeterPrimitive.Track>
      {(startLabel != null || endLabel != null) && (
        <span className={styles.labels} aria-hidden="true">
          <span className={styles.startLabel}>{startLabel}</span>
          {endLabel != null && <span className={styles.endLabel}>{endLabel}</span>}
        </span>
      )}
    </MeterPrimitive.Root>
  );
}

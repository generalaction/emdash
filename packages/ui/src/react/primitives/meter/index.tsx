import { Meter as MeterPrimitive } from '@base-ui/react/meter';
import { cx } from '@styles/utilities/cx';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import type { ReactNode } from 'react';
import * as styles from './meter.css';

export interface MeterProps extends Omit<MeterPrimitive.Root.Props, 'className' | 'children'> {
  label: string;
  tone?: 'neutral' | 'warning' | 'error';
  size?: 'sm' | 'lg';
  color?: string;
  striped?: boolean;
  startLabel?: ReactNode;
  endLabel?: ReactNode;
  className?: string;
}

export function Meter({
  label,
  tone = 'neutral',
  size = 'sm',
  color,
  striped = false,
  startLabel,
  endLabel,
  className,
  style,
  ...props
}: MeterProps) {
  return (
    <MeterPrimitive.Root
      {...props}
      aria-label={label}
      className={cx(styles.root({ tone }), className)}
      style={(state) => ({
        ...assignInlineVars({ [styles.meterColor]: color }),
        ...(typeof style === 'function' ? style(state) : style),
      })}
    >
      <MeterPrimitive.Track className={styles.track({ size, striped })}>
        <MeterPrimitive.Indicator className={styles.indicator({ size })} />
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

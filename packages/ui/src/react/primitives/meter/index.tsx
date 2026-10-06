import { Meter as MeterPrimitive } from '@base-ui/react/meter';
import { cx } from '@styles/utilities/cx';
import * as styles from './meter.css';

export interface MeterProps extends Omit<MeterPrimitive.Root.Props, 'className' | 'children'> {
  label: string;
  tone?: 'neutral' | 'warning' | 'error';
  className?: string;
}

export function Meter({ label, tone = 'neutral', className, ...props }: MeterProps) {
  return (
    <MeterPrimitive.Root {...props} aria-label={label} className={cx(styles.root, className)}>
      <MeterPrimitive.Track className={styles.track}>
        <MeterPrimitive.Indicator className={styles.indicator({ tone })} />
      </MeterPrimitive.Track>
    </MeterPrimitive.Root>
  );
}

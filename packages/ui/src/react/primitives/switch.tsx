import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import * as styles from './switch.css';

export interface SwitchProps extends Omit<SwitchPrimitive.Root.Props, 'className'> {
  className?: string;
}

const Switch = React.forwardRef<HTMLSpanElement, SwitchProps>(function Switch(
  { className, ...props },
  ref
) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      data-slot="switch"
      className={cx(styles.switchRoot, className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className={styles.switchThumb} />
    </SwitchPrimitive.Root>
  );
});

export { Switch };

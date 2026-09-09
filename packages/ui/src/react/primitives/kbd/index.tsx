import { cx } from '@styles/index';
import * as React from 'react';
import { IconSlot } from '../icon';
import * as styles from './kbd.css';

export interface KbdProps extends Omit<React.ComponentProps<'kbd'>, 'children'> {
  children?: React.ReactNode;
  /** Treats caller content as an opaque decorative icon and gives it authoritative sizing. */
  icon?: boolean;
}

function Kbd({ className, children, icon = false, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      data-icon={icon ? '' : undefined}
      className={cx(styles.kbd, className)}
      {...props}
    >
      {icon ? <IconSlot>{children}</IconSlot> : children}
    </kbd>
  );
}

export type KbdGroupProps = React.ComponentProps<'kbd'>;

function KbdGroup({ className, ...props }: KbdGroupProps) {
  return <kbd data-slot="kbd-group" className={cx(styles.kbdGroup, className)} {...props} />;
}

export { Kbd, KbdGroup };

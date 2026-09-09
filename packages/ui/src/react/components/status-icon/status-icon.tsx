import { cx } from '@styles/index';
import { BookIcon, CheckIcon, CircleMinusIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { Icon, type StaticSvgComponent } from '../../primitives/icon';
import * as styles from './status-icon.css';
import type { StatusIconVariants } from './status-icon.css';

export type StatusIconSeverity = 'success' | 'error' | 'warning' | 'info' | 'neutral';
export type StatusIconSize = NonNullable<StatusIconVariants['size']>;

export interface StatusIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual severity of the status icon. */
  severity?: StatusIconSeverity;
  /** Optional size of the status icon badge. */
  size?: StatusIconSize;
  /** Custom owned static SVG source. If omitted, severity chooses the source. */
  icon?: StaticSvgComponent;
}

const DEFAULT_ICONS: Record<StatusIconSeverity, StaticSvgComponent> = {
  success: CheckIcon,
  error: XIcon,
  warning: RefreshCwIcon,
  info: BookIcon,
  neutral: CircleMinusIcon,
};

/**
 * StatusIcon — a small rounded square badge that communicates a semantic state.
 *
 * Each severity maps to a default icon and a semantic background/foreground pair
 * from the design-system theme. The badge Recipe owns tone and inherited icon
 * size; `Icon` applies geometry and decorative accessibility to the static SVG
 * source itself. Caller `className` is applied to the badge span root.
 */
function StatusIcon({
  severity = 'neutral',
  size = 'md',
  icon,
  className,
  ...props
}: StatusIconProps) {
  return (
    <span
      {...props}
      data-severity={severity}
      data-size={size}
      className={cx(styles.statusIcon({ severity, size }), className)}
    >
      <Icon source={icon ?? DEFAULT_ICONS[severity]} strokeWidth={icon ? undefined : 2} />
    </span>
  );
}

export { StatusIcon };

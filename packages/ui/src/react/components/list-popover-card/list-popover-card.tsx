import { cx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import * as React from 'react';
import * as styles from './list-popover-card.css';

export type ListPopoverCardStatus = 'destructive' | 'warning' | 'info' | 'success';

export interface ListPopoverCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional status tint applied as the floating Surface's Tone. */
  status?: ListPopoverCardStatus;
}

/**
 * ListPopoverCard — a floating card pinned above the bottom edge of a list
 * container (which must be positioned). Used for selection action bars and
 * sync status banners that hover over list content.
 *
 * Children are caller-owned. `className` and remaining HTML attributes are
 * applied to the rendered painted card root; the outer positioner is private.
 */
function ListPopoverCard({ status, className, children, ...props }: ListPopoverCardProps) {
  return (
    <div data-slot="list-popover-card" className={styles.positioner}>
      <div
        data-status={status}
        className={cx(
          surface({ level: 'elevated', emphasis: true, tone: status }),
          styles.inner,
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

export { ListPopoverCard };

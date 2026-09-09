import type { SurfaceToneName } from '@emdash/theme';
import { cx } from '@styles/index';
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { Icon, IconSlot, type StaticSvgComponent } from '../icon';
import { Surface } from '../surface/surface';
import * as styles from './alert.css';

// ── Status icon map ───────────────────────────────────────────────────────────

const STATUS_ICONS: Record<SurfaceToneName, StaticSvgComponent> = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  destructive: AlertCircleIcon,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="alert-title" className={cx(styles.alertTitle, className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="alert-description"
      className={cx(styles.alertDescription, className)}
      {...props}
    />
  );
}

/**
 * AlertAction — free-form action slot pinned to the alert's top-right corner
 * (e.g. a "Fix" or "Retry" button). The root reserves horizontal room for it.
 */
function AlertAction({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="alert-action" className={cx(styles.alertAction, className)} {...props} />;
}

// ── Root ──────────────────────────────────────────────────────────────────────

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  status: SurfaceToneName;
  /**
   * Decorative caller-owned icon content. Omit for the status default or pass
   * `null` to suppress the icon.
   */
  icon?: React.ReactNode | null;
  onDismiss?: () => void;
}

function AlertRoot({ status, icon, onDismiss, className, children, ...props }: AlertProps) {
  return (
    <Surface
      role="alert"
      tone={status}
      data-slot="alert"
      className={cx(styles.alertRoot, className)}
      {...props}
    >
      {icon === undefined && <Icon source={STATUS_ICONS[status]} className={styles.alertIcon} />}
      {icon != null && <IconSlot className={styles.alertIcon}>{icon}</IconSlot>}
      <div className={styles.alertBody}>{children}</div>
      {onDismiss != null && (
        <button
          type="button"
          aria-label="Dismiss"
          className={styles.alertDismiss}
          onClick={onDismiss}
        >
          <Icon source={XIcon} />
        </button>
      )}
    </Surface>
  );
}

export const Alert = {
  Root: AlertRoot,
  Title: AlertTitle,
  Description: AlertDescription,
  Action: AlertAction,
};

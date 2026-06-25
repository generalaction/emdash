import { cx } from '@styles/utilities/cx';
import type { SurfaceStatusName } from '@theme/core/contract/roles';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
  XIcon,
} from 'lucide-react';
import * as React from 'react';
import { Surface } from './surface';
import * as styles from './alert.css';

// ── Status icon map ───────────────────────────────────────────────────────────

const STATUS_ICONS: Record<SurfaceStatusName, React.ReactNode> = {
  info: <InfoIcon />,
  success: <CheckCircleIcon />,
  warning: <AlertTriangleIcon />,
  destructive: <AlertCircleIcon />,
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

// ── Root ──────────────────────────────────────────────────────────────────────

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Status variant — controls the tinted background, border, and text color
   * via the status surface cascade.
   */
  status: SurfaceStatusName;
  /**
   * Override the default status icon. Pass `null` to suppress the icon entirely.
   */
  icon?: React.ReactNode | null;
  /**
   * Called when the user clicks the dismiss button.
   * When provided, a close button is rendered in the top-right corner.
   */
  onDismiss?: () => void;
}

/**
 * Alert — a prominent, optionally dismissible notification banner.
 *
 * Distinct from `Callout`: Alert stands alone (page-level notices, form
 * submission results, async errors), while Callout is embedded inline in
 * flowing content.
 *
 * Compose with `AlertTitle` and `AlertDescription` for structured content,
 * or pass children directly for simple single-line messages.
 *
 * Usage:
 *   <Alert status="info" onDismiss={() => setVisible(false)}>
 *     <AlertTitle>Update available</AlertTitle>
 *     <AlertDescription>Restart the app to apply the latest changes.</AlertDescription>
 *   </Alert>
 *
 *   <Alert status="destructive">Connection to remote host failed.</Alert>
 */
function Alert({ status, icon, onDismiss, className, children, ...props }: AlertProps) {
  const resolvedIcon = icon === null ? null : (icon ?? STATUS_ICONS[status]);

  return (
    <Surface
      role="alert"
      status={status}
      data-slot="alert"
      className={cx(styles.alertRoot, className)}
      {...props}
    >
      {resolvedIcon != null && (
        <span className={styles.alertIcon} aria-hidden>
          {resolvedIcon}
        </span>
      )}
      <div className={styles.alertBody}>{children}</div>
      {onDismiss != null && (
        <button
          type="button"
          aria-label="Dismiss"
          className={styles.alertDismiss}
          onClick={onDismiss}
        >
          <XIcon aria-hidden />
        </button>
      )}
    </Surface>
  );
}

export { Alert, AlertDescription, AlertTitle };

import { cx } from '@styles/utilities/cx';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  RefreshCwIcon,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '../primitives/button';
import * as styles from './update-card.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version?: string }
  | { kind: 'not-available' }
  | { kind: 'downloading'; percent?: number }
  | { kind: 'downloaded' }
  | { kind: 'installing' }
  | { kind: 'error'; message?: string };

export interface UpdateCardProps {
  /** Current installed version string (e.g. `"1.4.2"`). Shown as a badge. */
  currentVersion?: string;
  /** Drives all status text, icons, action buttons, and progress bar. */
  status: UpdateStatus;
  /** App name used in status messages, e.g. "Restart Emdash to apply the update." */
  appName?: string;
  /** Called when the refresh (check for update) icon button is clicked. */
  onCheck?: () => void;
  /** Called when the Download button is clicked. */
  onDownload?: () => void;
  /** Called when the Restart button is clicked. */
  onInstall?: () => void;
  className?: string;
}

// ── Icon sizes ────────────────────────────────────────────────────────────────

const ICON_SM: React.CSSProperties = { width: '0.75rem', height: '0.75rem', flexShrink: 0 };
const ICON_MD: React.CSSProperties = { width: '1rem', height: '1rem', flexShrink: 0 };

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * UpdateCard — displays the current app version and its update lifecycle.
 *
 * Fully controlled: all state is expressed via the `status` prop union, and
 * all actions are forwarded to callbacks. No internal async logic.
 *
 * Status → UI mapping:
 * | status       | Description                        | Action             | Progress |
 * |--------------|------------------------------------|--------------------|----------|
 * | idle         | "You're up to date."               | —                  | hidden   |
 * | not-available| "You're up to date."               | —                  | hidden   |
 * | checking     | "Checking for updates…" + spinner  | —                  | hidden   |
 * | available    | "Version X is available"           | Download           | hidden   |
 * | downloading  | "Downloading… (N%)"                | Downloading (dis.) | shown    |
 * | downloaded   | "Update ready. Restart…"           | Restart            | hidden   |
 * | installing   | "Installing…" + spinner            | Installing (dis.)  | hidden   |
 * | error        | warning badge                      | —                  | hidden   |
 *
 * Usage:
 * ```tsx
 * <UpdateCard
 *   currentVersion="1.4.2"
 *   status={{ kind: 'available', version: '1.5.0' }}
 *   appName="Emdash"
 *   onCheck={handleCheck}
 *   onDownload={handleDownload}
 *   onInstall={handleInstall}
 * />
 * ```
 */
function UpdateCard({
  currentVersion,
  status,
  appName = 'the app',
  onCheck,
  onDownload,
  onInstall,
  className,
}: UpdateCardProps) {
  const isChecking = status.kind === 'checking';
  const showCheckButton = status.kind !== 'downloaded' && status.kind !== 'installing';

  const downloadPercent = status.kind === 'downloading' ? (status.percent ?? 0) : 0;

  return (
    <div className={cx(styles.card, className)}>
      <div className={styles.row}>
        {/* ── Left: title + status description ── */}
        <div className={styles.rowBody}>
          <div className={styles.rowTitle}>
            Version
            {currentVersion && <span className={styles.versionBadge}>v{currentVersion}</span>}
          </div>
          <div className={styles.rowDescription}>
            <StatusDescription status={status} appName={appName} />
          </div>
        </div>

        {/* ── Right: check icon + action button ── */}
        <div className={styles.rowControls}>
          {showCheckButton && (
            <Button
              variant="ghost"
              size="sm"
              icon
              onClick={onCheck}
              disabled={isChecking}
              aria-label="Check for updates"
            >
              <RefreshCwIcon style={ICON_MD} className={isChecking ? styles.iconSpin : undefined} />
            </Button>
          )}
          <ActionButton status={status} onDownload={onDownload} onInstall={onInstall} />
        </div>
      </div>

      {/* ── Progress bar (downloading only) ── */}
      {status.kind === 'downloading' && (
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${downloadPercent}%` }}
            role="progressbar"
            aria-valuenow={downloadPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </div>
  );
}

// ── Status description ────────────────────────────────────────────────────────

function StatusDescription({ status, appName }: { status: UpdateStatus; appName: string }) {
  switch (status.kind) {
    case 'checking':
      return (
        <>
          <Loader2Icon style={ICON_SM} className={styles.iconSpin} />
          Checking for updates…
        </>
      );

    case 'available':
      return status.version ? (
        <>Version {status.version} is available.</>
      ) : (
        <>An update is available.</>
      );

    case 'downloading':
      return (
        <>
          Downloading update
          {status.percent != null ? ` (${Math.round(status.percent)}%)` : '…'}
        </>
      );

    case 'downloaded':
      return (
        <span className={styles.statusSuccess}>
          <CheckCircle2Icon style={ICON_SM} />
          Update ready. Restart {appName} to use the new version.
        </span>
      );

    case 'installing':
      return (
        <>
          <Loader2Icon style={ICON_SM} className={styles.iconSpin} />
          Installing update. {appName} will restart automatically.
        </>
      );

    case 'error':
      return (
        <span className={styles.statusWarning}>
          <AlertCircleIcon style={ICON_SM} />
          Update temporarily unavailable — please try again later.
        </span>
      );

    case 'idle':
    case 'not-available':
    default:
      return (
        <span className={styles.statusSuccess}>
          <CheckCircle2Icon style={ICON_SM} />
          You&apos;re up to date.
        </span>
      );
  }
}

// ── Action button ─────────────────────────────────────────────────────────────

function ActionButton({
  status,
  onDownload,
  onInstall,
}: {
  status: UpdateStatus;
  onDownload?: () => void;
  onInstall?: () => void;
}) {
  switch (status.kind) {
    case 'available':
      return (
        <Button size="sm" onClick={onDownload}>
          <DownloadIcon style={ICON_MD} />
          Download
        </Button>
      );

    case 'downloading':
      return (
        <Button size="sm" variant="ghost" disabled>
          <Loader2Icon style={ICON_MD} className={styles.iconSpin} />
          Downloading
        </Button>
      );

    case 'downloaded':
      return (
        <Button size="sm" onClick={onInstall}>
          <RefreshCwIcon style={ICON_MD} />
          Restart
        </Button>
      );

    case 'installing':
      return (
        <Button size="sm" variant="ghost" disabled>
          <Loader2Icon style={ICON_MD} className={styles.iconSpin} />
          Installing
        </Button>
      );

    default:
      return null;
  }
}

export { UpdateCard };

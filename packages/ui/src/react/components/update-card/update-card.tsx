import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import { Box } from '../../primitives/box';
import { Button } from '../../primitives/button';
import { useAsyncAction } from '../../primitives/hooks/use-async-action';
import { StatusIcon } from '../status-icon/status-icon';
import * as styles from './update-card.css';

export type UpdateStatus =
  | { type: 'up-to-date' }
  | { type: 'checking' }
  | { type: 'update-available'; version: string; onUpdate: () => Promise<void> }
  | {
      type: 'update-download-available';
      version: string;
      size: number;
      onDownload: () => Promise<void>;
    }
  | { type: 'update-downloading'; version: string; progress?: number }
  | { type: 'update-install-available'; onInstall: () => Promise<void> }
  | { type: 'update-installing' };

export interface UpdateCardProps {
  currentVersion: string;
  status: UpdateStatus;
  appName: string;
  onCheckForUpdates: () => Promise<void>;
  /** A readable summary and, when needed, full sanitized diagnostic details. */
  error?: { message: string; details?: string };
}

export function UpdateCard({
  currentVersion,
  status,
  appName = 'app',
  onCheckForUpdates,
  error,
}: UpdateCardProps) {
  const [checkForUpdates, , isCheckingForUpdates] = useAsyncAction(async () => {
    await onCheckForUpdates();
  });
  const [downloadUpdate, , isDownloadRequested] = useAsyncAction(async () => {
    if (status.type === 'update-download-available') await status.onDownload();
  });
  const [updateNow, , isUpdating] = useAsyncAction(async () => {
    if (status.type === 'update-available') await status.onUpdate();
  });
  const [installUpdate, , isInstallRequested] = useAsyncAction(async () => {
    if (status.type === 'update-install-available') await status.onInstall();
  });

  const renderActionButton = () => {
    switch (status.type) {
      case 'checking':
      case 'up-to-date': {
        const checking = status.type === 'checking' || isCheckingForUpdates;
        return (
          <Button
            variant="secondary"
            size="xs"
            onClick={checkForUpdates}
            disabled={checking}
            aria-busy={checking}
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        );
      }
      case 'update-available':
        return (
          <Button
            variant="secondary"
            size="xs"
            onClick={updateNow}
            disabled={isUpdating}
            aria-busy={isUpdating}
          >
            {isUpdating ? 'Updating…' : 'Update'}
          </Button>
        );
      case 'update-download-available':
        return isDownloadRequested ? (
          <DownloadingButton />
        ) : (
          <Button variant="secondary" size="xs" onClick={downloadUpdate}>
            {error ? 'Retry download' : 'Download'}
          </Button>
        );
      case 'update-downloading':
        return <DownloadingButton progress={status.progress} />;
      case 'update-installing':
      case 'update-install-available': {
        const installing = status.type === 'update-installing' || isInstallRequested;
        return (
          <Button
            variant="secondary"
            size="xs"
            onClick={installUpdate}
            disabled={installing}
            aria-busy={installing}
          >
            {installing ? 'Restarting…' : 'Restart'}
          </Button>
        );
      }
    }
  };

  const renderStatusLabel = () => {
    switch (status.type) {
      case 'checking':
        return 'Checking for updates';
      case 'up-to-date':
        return error ? 'Could not check for updates' : "You're up to date";
      case 'update-downloading':
        return 'Downloading update';
      case 'update-installing':
        return 'Restarting to install update';
      case 'update-install-available':
        return 'Update ready to install';
      default:
        return 'An update is available';
    }
  };

  const renderStatusDescription = () => {
    switch (status.type) {
      case 'checking':
        return `Current ${appName} version v${currentVersion}`;
      case 'up-to-date':
        return error
          ? `Current ${appName} version v${currentVersion}`
          : `Current ${appName} version v${currentVersion} is up to date`;
      case 'update-available':
        return `Version v${status.version} is available. Update and restart ${appName} to use the new version`;
      case 'update-download-available':
        return `Version v${status.version} is available. Download and restart ${appName} to use the new version`;
      case 'update-downloading':
        return `Downloading version v${status.version}. You can keep using ${appName} while it downloads.`;
      case 'update-installing':
        return `${appName} will reopen with the new version`;
      case 'update-install-available':
        return `Restart ${appName} to use the new version`;
    }
  };

  return (
    <Box surface="sunken" borderRadius="md" padding="2" px="3" className={styles.card}>
      <div className={styles.row}>
        <StatusIcon
          size="lg"
          severity={error ? 'error' : status.type === 'up-to-date' ? 'success' : 'warning'}
        />
        <div className={styles.rowBody}>
          <div className={styles.rowTitle}>{renderStatusLabel()}</div>
          <div className={styles.rowDescription}>{renderStatusDescription()}</div>
        </div>
        <div className={styles.rowControls}>{renderActionButton()}</div>
      </div>
      {error && <UpdateError key={error.details ?? error.message} error={error} />}
    </Box>
  );
}

function DownloadingButton({ progress }: { progress?: number }) {
  const percent =
    progress != null && Number.isFinite(progress)
      ? Math.round(Math.min(100, Math.max(0, progress)))
      : undefined;
  return (
    <Button variant="secondary" size="xs" disabled aria-busy="true">
      {percent === undefined ? 'Downloading…' : `Downloading… ${percent}%`}
    </Button>
  );
}

function UpdateError({ error }: { error: NonNullable<UpdateCardProps['error']> }) {
  const details = error.details ?? error.message;
  const [copyFailed, setCopyFailed] = React.useState(false);
  const [copyDetails, copied, copying] = useAsyncAction(
    async () => {
      setCopyFailed(false);
      await navigator.clipboard.writeText(details);
      return true;
    },
    { onError: () => setCopyFailed(true) }
  );

  return (
    <div className={styles.errorPanel}>
      <div className={styles.errorMessage} role="alert">
        {error.message}
      </div>
      <div className={styles.errorActions}>
        {details !== error.message && (
          <details className={styles.errorDetails}>
            <summary className={styles.errorSummary}>Details</summary>
            <div className={styles.errorDetailsText}>{details}</div>
          </details>
        )}
        <Button variant="ghost" size="xs" onClick={copyDetails} disabled={copying}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy details'}
        </Button>
      </div>
      {copyFailed && (
        <div className={styles.errorMessage} role="status">
          Could not copy. Select the text to copy it manually.
        </div>
      )}
    </div>
  );
}

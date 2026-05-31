import { AlertCircle, CheckCircle2, Download, Loader2, Play, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { formatBytes } from '@renderer/utils/formatBytes';
import { PRODUCT_NAME } from '@shared/app-identity';
import { SettingRow } from './SettingRow';

export const UpdateCard = observer(function UpdateCard(): React.JSX.Element {
  const update = appState.update;
  const downloadProgress =
    update.state.status === 'downloading' ? update.state.progress : undefined;
  const progressPercent = Math.round(downloadProgress?.percent ?? 0);
  const hasByteProgress =
    downloadProgress !== undefined &&
    ((downloadProgress.total ?? 0) > 0 || (downloadProgress.transferred ?? 0) > 0);
  // The check/refresh action only makes sense before a download is underway.
  const showCheckButton =
    update.state.status !== 'downloading' &&
    update.state.status !== 'downloaded' &&
    update.state.status !== 'installing';

  const versionTitle = (
    <div className="flex items-center gap-2">
      Version
      {update.currentVersion && (
        <Badge variant="outline" className="h-5 px-2 font-mono text-xs">
          v{update.currentVersion}
        </Badge>
      )}
    </div>
  );

  return (
    <div className="grid gap-3">
      <SettingRow
        title={versionTitle}
        description={renderStatusMessage()}
        control={
          <div className="flex items-center gap-2">
            {showCheckButton && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => update.check()}
                disabled={update.state.status === 'checking'}
                aria-label="Check for updates"
              >
                <RefreshCw
                  className={`h-3 w-3 ${update.state.status === 'checking' ? 'animate-spin' : ''}`}
                />
              </Button>
            )}
            {renderAction()}
          </div>
        }
      />

      {update.state.status === 'downloading' && downloadProgress && (
        <div className="space-y-2">
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-all duration-300 ease-out"
              style={{ width: `${downloadProgress.percent || 0}%` }}
            />
          </div>
          {hasByteProgress && (
            <p className="text-muted-foreground text-xs">
              {formatBytes(downloadProgress.transferred || 0)} /{' '}
              {formatBytes(downloadProgress.total || 0)}
            </p>
          )}
        </div>
      )}

      {import.meta.env.DEV && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground-passive">Dev: simulate update</span>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="w-fit"
            onClick={() => update.simulateUpdateFlow()}
          >
            <Play className="mr-1.5 h-3 w-3" />
            Play successful update flow
          </Button>
        </div>
      )}
    </div>
  );

  function renderStatusMessage() {
    switch (update.state.status) {
      case 'checking':
        return (
          <p className="text-muted-foreground flex items-center gap-1 text-sm">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking for updates...
          </p>
        );

      case 'available':
        if (update.state.info?.version) {
          return (
            <p className="text-muted-foreground text-sm">
              Version {update.state.info.version} is available
            </p>
          );
        }
        return <p className="text-muted-foreground text-sm">An update is available</p>;

      case 'downloading': {
        const transferred = downloadProgress?.transferred ?? 0;
        const total = downloadProgress?.total ?? 0;
        const speed = downloadProgress?.bytesPerSecond ?? 0;
        const sizeLabel = total > 0 ? `${formatBytes(transferred)} / ${formatBytes(total)}` : '';
        const speedLabel = speed > 0 ? `${formatBytes(speed)}/s` : '';
        const detail = [sizeLabel, speedLabel].filter(Boolean).join(' · ');
        return (
          <p className="text-muted-foreground text-sm tabular-nums">
            {detail ? `Downloading update · ${detail}` : 'Downloading update…'}
          </p>
        );
      }

      case 'downloaded':
        return (
          <p className="flex items-center gap-1 text-sm text-foreground-success">
            <CheckCircle2 className="h-3 w-3" />
            Update ready. Restart {PRODUCT_NAME} to use the new version.
          </p>
        );

      case 'installing':
        return (
          <p className="text-muted-foreground flex items-center gap-1 text-sm">
            <Loader2 className="h-3 w-3 animate-spin" />
            Installing update. {PRODUCT_NAME} will close and restart automatically — this may take a
            few seconds.
          </p>
        );

      case 'error':
        return (
          <Badge
            variant="outline"
            className="border-border-warning bg-background-warning text-foreground-warning"
          >
            <AlertCircle className="h-3 w-3" />
            Update temporarily unavailable — please try again later
          </Badge>
        );

      default:
        return (
          <p className="text-muted-foreground flex items-center gap-1 text-sm">
            <CheckCircle2 className="h-3 w-3 text-foreground-success" />
            You're up to date.{' '}
          </p>
        );
    }
  }

  function renderAction() {
    switch (update.state.status) {
      case 'available':
        return (
          <Button size="default" variant="default" onClick={() => update.download()}>
            <Download className="mr-1.5 h-4 w-4" />
            Download
          </Button>
        );

      case 'downloading':
        return (
          <Button size="default" variant="outline" disabled>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            Downloading {progressPercent}%
          </Button>
        );

      case 'downloaded':
        return (
          <Button size="default" variant="default" onClick={() => update.install()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Restart
          </Button>
        );

      case 'installing':
        return (
          <Button size="default" variant="outline" disabled>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            Installing
          </Button>
        );

      default:
        return null;
    }
  }
});

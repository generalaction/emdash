import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { PRODUCT_NAME } from '@shared/app-identity';
import { appState } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { formatBytes } from '@renderer/utils/formatBytes';
import { SettingRow } from './SettingRow';

export const UpdateCard = observer(function UpdateCard(): React.JSX.Element {
  const update = appState.update;
  const downloadProgress =
    update.state.status === 'downloading' ? update.state.progress : undefined;
  const hasByteProgress =
    downloadProgress !== undefined &&
    ((downloadProgress.total ?? 0) > 0 || (downloadProgress.transferred ?? 0) > 0);

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
            {update.state.status !== 'downloaded' && update.state.status !== 'installing' && (
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
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${downloadProgress.percent || 0}%` }}
            />
          </div>
          {hasByteProgress && (
            <p className="text-xs text-muted-foreground">
              {formatBytes(downloadProgress.transferred || 0)} /{' '}
              {formatBytes(downloadProgress.total || 0)}
            </p>
          )}
        </div>
      )}
    </div>
  );

  function renderStatusMessage() {
    switch (update.state.status) {
      case 'checking':
        return (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking for updates...
          </p>
        );

      case 'available':
        if (update.state.info?.version) {
          return (
            <p className="text-sm text-muted-foreground">
              Version {update.state.info.version} is available
            </p>
          );
        }
        return <p className="text-sm text-muted-foreground">An update is available</p>;

      case 'downloading':
        return (
          <p className="text-sm text-muted-foreground">
            Downloading update{update.progressLabel ? ` (${update.progressLabel})` : '...'}
          </p>
        );

      case 'downloaded':
        return (
          <p className="flex items-center gap-1 text-sm text-green-600 dark:text-green-500">
            <CheckCircle2 className="h-3 w-3" />
            Update ready. Restart {PRODUCT_NAME} to use the new version.
          </p>
        );

      case 'installing':
        return (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Installing update. {PRODUCT_NAME} will close and restart automatically — this may take a
            few seconds.
          </p>
        );

      case 'error':
        return (
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
          >
            <AlertCircle className="h-3 w-3" />
            Update temporarily unavailable — please try again later
          </Badge>
        );

      default:
        return (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-500" />
            You're up to date.{' '}
          </p>
        );
    }
  }

  function renderAction() {
    switch (update.state.status) {
      case 'available':
        return (
          <Button
            size="sm"
            variant="default"
            onClick={() => update.download()}
            className="h-7 text-xs"
          >
            <Download className="mr-1.5 h-3 w-3" />
            Download
          </Button>
        );

      case 'downloading':
        return (
          <Button size="sm" variant="outline" disabled className="h-7 text-xs">
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            Downloading
          </Button>
        );

      case 'downloaded':
        return (
          <Button
            size="sm"
            variant="default"
            onClick={() => update.install()}
            className="h-7 text-xs"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Restart
          </Button>
        );

      case 'installing':
        return (
          <Button size="sm" variant="outline" disabled className="h-7 text-xs">
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            Installing
          </Button>
        );

      default:
        return null;
    }
  }
});

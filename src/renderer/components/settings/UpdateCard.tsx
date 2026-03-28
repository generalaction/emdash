import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { EMDASH_RELEASES_URL, useUpdater } from '@renderer/hooks/useUpdater';
import { rpc } from '../../core/ipc';
import { SettingRow } from './SettingRow';

export function UpdateCard(): JSX.Element {
  const updater = useUpdater();
  const [appVersion, setAppVersion] = useState<string>('');
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    rpc.app
      .getAppVersion()
      .then((r: any) => setAppVersion(typeof r === 'string' ? r : (r?.version ?? 'Unknown')))
      .catch(() => setAppVersion('Unknown'));

    setIsDev(window.location.hostname === 'localhost' || !window.electronAPI);
  }, []);

  const handleCheckNow = async () => {
    await updater.check();
  };

  const handleDownload = async () => {
    await updater.download();
  };

  const handleInstall = () => {
    updater.install();
  };

  const versionTitle = (
    <div className="flex items-center gap-2">
      Version
      {appVersion && (
        <Badge variant="outline" className="h-5 px-2 font-mono text-xs">
          v{appVersion}
        </Badge>
      )}
    </div>
  );

  // In dev, show simple informational message
  if (isDev) {
    return (
      <SettingRow
        title={versionTitle}
        description={
          <>
            Auto-updates are enabled in production builds.{' '}
            <button
              type="button"
              onClick={() => rpc.app.openExternal(EMDASH_RELEASES_URL)}
              className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground"
            >
              View changelog ↗
            </button>
          </>
        }
        control={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleCheckNow}
            disabled
            aria-label="Check for updates (disabled in development)"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-3">
      <SettingRow
        title={versionTitle}
        description={renderStatusMessage()}
        control={
          <div className="flex items-center gap-2">
            {updater.state.status !== 'downloaded' && updater.state.status !== 'installing' && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handleCheckNow}
                disabled={updater.state.status === 'checking'}
                aria-label="Check for updates"
              >
                <RefreshCw
                  className={`h-3 w-3 ${updater.state.status === 'checking' ? 'animate-spin' : ''}`}
                />
              </Button>
            )}
            {renderAction()}
          </div>
        }
      />

      {updater.state.status === 'downloading' && updater.state.progress && (
        <div className="space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${updater.state.progress.percent || 0}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatBytes(updater.state.progress.transferred || 0)} /{' '}
            {formatBytes(updater.state.progress.total || 0)}
          </p>
        </div>
      )}
    </div>
  );

  function renderStatusMessage() {
    switch (updater.state.status) {
      case 'checking':
        return (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking for updates...
          </p>
        );

      case 'available':
        if (updater.state.info?.version) {
          return (
            <p className="text-sm text-muted-foreground">
              Version {updater.state.info.version} is available
            </p>
          );
        }
        return <p className="text-sm text-muted-foreground">An update is available</p>;

      case 'downloading':
        return (
          <p className="text-sm text-muted-foreground">
            Downloading update{updater.progressLabel ? ` (${updater.progressLabel})` : '...'}
          </p>
        );

      case 'downloaded':
        return (
          <p className="flex items-center gap-1 text-sm text-green-600 dark:text-green-500">
            <CheckCircle2 className="h-3 w-3" />
            Update ready. Restart Emdash to use the new version.
          </p>
        );

      case 'installing':
        return (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Installing update. Emdash will close and restart automatically — this may take a few
            seconds.
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
            <button
              type="button"
              onClick={() => rpc.app.openExternal(EMDASH_RELEASES_URL)}
              className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground"
            >
              View changelog ↗
            </button>
          </p>
        );
    }
  }

  function renderAction() {
    switch (updater.state.status) {
      case 'available':
        return (
          <Button size="sm" variant="default" onClick={handleDownload} className="h-7 text-xs">
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
          <Button size="sm" variant="default" onClick={handleInstall} className="h-7 text-xs">
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

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

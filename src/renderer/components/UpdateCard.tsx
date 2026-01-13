import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Download, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { useUpdater } from '@/hooks/useUpdater';

export function UpdateCard(): JSX.Element {
  const updater = useUpdater();
  const [appVersion, setAppVersion] = useState<string>('');
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    window.electronAPI
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('Unknown'));

    setIsDev(window.location.hostname === 'localhost' || !window.electronAPI);
  }, []);

  const handleCheckNow = async () => {
    await updater.check();
  };

  const handleDownload = async () => {
    const result = await updater.download();
    // If download fails due to missing zip file, offer manual download
    if (!result?.success && updater.state.status === 'error') {
      const errorMessage = updater.state.message || '';
      if (errorMessage.includes('ZIP_FILE_NOT_FOUND') || errorMessage.includes('404')) {
        // Auto-update not available, open manual download
        await window.electronAPI.openLatestDownload();
      }
    }
  };

  const handleInstall = () => {
    updater.install();
  };

  // In dev, show simple informational message
  if (isDev) {
    return (
      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Version</p>
              {appVersion && (
                <Badge variant="outline" className="h-5 px-2 font-mono text-xs">
                  v{appVersion}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Auto-updates are enabled in production builds
            </p>
          </div>
        </div>

        <div className="mt-2">
          <a
            href="https://github.com/generalaction/emdash/releases"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View latest release →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Version</p>
            {appVersion && (
              <Badge variant="outline" className="h-5 px-2 font-mono text-xs">
                v{appVersion}
              </Badge>
            )}
          </div>
          {renderStatusMessage()}
        </div>
        {renderAction()}
      </div>

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

      <div className="mt-2">
        <a
          href="https://github.com/generalaction/emdash/releases"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          View latest release →
        </a>
      </div>
    </div>
  );

  function renderStatusMessage() {
    switch (updater.state.status) {
      case 'checking':
        return (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking for updates...
          </p>
        );

      case 'available':
        if (updater.state.info?.version) {
          return (
            <p className="text-xs text-muted-foreground">
              Version {updater.state.info.version} is available
            </p>
          );
        }
        return <p className="text-xs text-muted-foreground">An update is available</p>;

      case 'downloading':
        return (
          <p className="text-xs text-muted-foreground">
            Downloading update{updater.progressLabel ? ` (${updater.progressLabel})` : '...'}
          </p>
        );

      case 'downloaded':
        return (
          <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
            <CheckCircle2 className="h-3 w-3" />
            Update ready to install
          </p>
        );

      case 'error':
        const errorMsg = updater.state.message || 'Update check failed';
        const isZipError = errorMsg.includes('ZIP_FILE_NOT_FOUND') || errorMsg.includes('404');
        return (
          <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-500">
            <AlertCircle className="h-3 w-3" />
            {isZipError
              ? 'There was a problem with the update, manual download required'
              : errorMsg}
          </p>
        );

      default:
        return (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-500" />
            You're up to date
          </p>
        );
    }
  }

  function renderAction() {
    switch (updater.state.status) {
      case 'checking':
        return null;

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
          <Button
            size="sm"
            variant="default"
            onClick={handleInstall}
            className="h-7 bg-green-600 text-xs hover:bg-green-700"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Restart
          </Button>
        );

      case 'error':
        const err = updater.state.message || '';
        const needsManual = err.includes('ZIP_FILE_NOT_FOUND') || err.includes('404');
        if (needsManual) {
          return (
            <Button
              size="sm"
              variant="default"
              onClick={() => window.electronAPI.openLatestDownload()}
              className="h-7 text-xs"
            >
              <Download className="mr-1.5 h-3 w-3" />
              Manual Download
            </Button>
          );
        }
        return (
          <Button size="sm" variant="outline" onClick={handleCheckNow} className="h-7 text-xs">
            Try Again
          </Button>
        );

      default:
        return (
          <Button size="sm" variant="ghost" onClick={handleCheckNow} className="h-7 text-xs">
            Check Now
          </Button>
        );
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

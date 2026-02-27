import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useUpdater, EMDASH_RELEASES_URL } from '@/hooks/useUpdater';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UpdateModal({ isOpen, onClose }: UpdateModalProps): JSX.Element {
  const updater = useUpdater();
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.electronAPI
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('Unknown'));
  }, []);

  // Auto-check when modal opens if not already in a progressed state
  useEffect(() => {
    if (!isOpen) return;
    const { status } = updater.state;
    if (status === 'idle' || status === 'not-available') {
      updater.check();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleCheck = async () => {
    await updater.check();
  };

  const handleDownload = async () => {
    await updater.download();
  };

  const handleInstall = () => {
    updater.install();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm focus:outline-none">
        <DialogHeader>
          <DialogTitle>Software Update</DialogTitle>
          <DialogDescription>
            Current version: v{appVersion || '...'} &middot;{' '}
            <button
              type="button"
              onClick={() => window.electronAPI.openExternal(EMDASH_RELEASES_URL)}
              className="inline-flex items-center gap-1 outline-none hover:text-foreground"
            >
              Changelog <ExternalLink className="h-3 w-3" />
            </button>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {updater.state.status === 'checking' && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Checking for updates...</p>
            </>
          )}

          {(updater.state.status === 'idle' || updater.state.status === 'not-available') && (
            <>
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
              <p className="text-sm">Emdash is up to date.</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  OK
                </Button>
                <Button variant="outline" size="sm" onClick={handleCheck}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Check Again
                </Button>
              </div>
            </>
          )}

          {updater.state.status === 'available' && (
            <>
              <Download className="h-8 w-8 text-primary" />
              <p className="text-sm text-muted-foreground">
                {updater.state.info?.version
                  ? `Version ${updater.state.info.version} is available.`
                  : 'An update is available.'}
              </p>
              <Button size="sm" onClick={handleDownload}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download
              </Button>
            </>
          )}

          {updater.state.status === 'downloading' && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Downloading update{updater.progressLabel ? ` (${updater.progressLabel})` : '...'}
              </p>
              {updater.state.progress && (
                <div className="w-full space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all duration-300 ease-out"
                      style={{ width: `${updater.state.progress.percent || 0}%` }}
                    />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    {formatBytes(updater.state.progress.transferred || 0)} /{' '}
                    {formatBytes(updater.state.progress.total || 0)}
                  </p>
                </div>
              )}
            </>
          )}

          {updater.state.status === 'downloaded' && (
            <>
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
              <p className="text-sm">Update downloaded and ready to install.</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Later
                </Button>
                <Button size="sm" onClick={handleInstall}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Restart Now
                </Button>
              </div>
            </>
          )}

          {updater.state.status === 'installing' && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-center text-sm text-muted-foreground">
                Installing update. Emdash will close automatically when ready.
              </p>
            </>
          )}

          {updater.state.status === 'error' && (
            <>
              <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-500" />
              <p className="text-center text-sm text-muted-foreground">
                {updater.state.message || 'Update check failed'}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Close
                </Button>
                <Button size="sm" variant="outline" onClick={handleCheck}>
                  Try Again
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
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

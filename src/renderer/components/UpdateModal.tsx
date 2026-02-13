import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Download, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { useUpdater, type UpdateState } from '@/hooks/useUpdater';

const isDev = window.location.hostname === 'localhost';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SimState = UpdateState & { progress?: { percent: number; transferred: number; total: number } };

function useDevSimulation(isOpen: boolean) {
  const [state, setState] = useState<SimState>({ status: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const cleanup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const run = useCallback(() => {
    cleanup();
    setState({ status: 'checking' });

    const totalBytes = 85_432_000;

    timerRef.current = setTimeout(() => {
      setState({ status: 'available', info: { version: '99.0.0' } });

      timerRef.current = setTimeout(() => {
        let percent = 0;
        const tick = () => {
          percent += 2 + Math.random() * 6;
          if (percent >= 100) {
            setState({ status: 'downloaded' });
            return;
          }
          const transferred = Math.round((percent / 100) * totalBytes);
          setState({
            status: 'downloading',
            progress: { percent, transferred, total: totalBytes },
          });
          timerRef.current = setTimeout(tick, 100 + Math.random() * 150);
        };
        tick();
      }, 800);
    }, 1200);
  }, [cleanup]);

  useEffect(() => {
    if (isOpen) run();
    return cleanup;
  }, [isOpen, run, cleanup]);

  const progressLabel = state.status === 'downloading' && state.progress
    ? `${(state.progress.percent).toFixed(0)}%`
    : '';

  return {
    state,
    progressLabel,
    install: () => {},
    check: run,
    download: async () => {},
    openLatest: async () => {},
  };
}

export function UpdateModal({ isOpen, onClose }: UpdateModalProps): JSX.Element {
  const realUpdater = useUpdater();
  const devSim = useDevSimulation(isOpen && isDev);
  const updater = isDev ? devSim : realUpdater;

  const [appVersion, setAppVersion] = useState('');
  const autoDownloadTriggered = useRef(false);

  useEffect(() => {
    window.electronAPI
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('Unknown'));
  }, []);

  // Trigger check when modal opens (production only)
  useEffect(() => {
    if (isOpen && !isDev) {
      autoDownloadTriggered.current = false;
      realUpdater.check();
    }
  }, [isOpen]);

  // Auto-download when an update is found (production only)
  useEffect(() => {
    if (isOpen && !isDev && realUpdater.state.status === 'available' && !autoDownloadTriggered.current) {
      autoDownloadTriggered.current = true;
      handleDownload();
    }
  }, [isOpen, realUpdater.state.status]);

  const handleDownload = async () => {
    const result = await realUpdater.download();
    if (!result?.success && realUpdater.state.status === 'error') {
      const errorMessage = realUpdater.state.message || '';
      if (errorMessage.includes('ZIP_FILE_NOT_FOUND') || errorMessage.includes('404')) {
        await window.electronAPI.openLatestDownload();
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Software Update</DialogTitle>
          <DialogDescription>Current version: v{appVersion || '...'}</DialogDescription>
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
              <Button variant="outline" size="sm" onClick={onClose}>
                OK
              </Button>
            </>
          )}

          {updater.state.status === 'available' && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {updater.state.info?.version
                  ? `Version ${updater.state.info.version} found. Downloading...`
                  : 'Update found. Downloading...'}
              </p>
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
                <Button size="sm" onClick={() => updater.install()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Restart Now
                </Button>
              </div>
            </>
          )}

          {updater.state.status === 'error' && renderError()}
        </div>
      </DialogContent>
    </Dialog>
  );

  function renderError() {
    const errorMsg = updater.state.status === 'error' ? updater.state.message : '';
    const isZipError = errorMsg.includes('ZIP_FILE_NOT_FOUND') || errorMsg.includes('404');

    if (isZipError) {
      return (
        <>
          <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-500" />
          <p className="text-center text-sm text-muted-foreground">
            Auto-update unavailable. Please download manually.
          </p>
          <Button size="sm" onClick={() => window.electronAPI.openLatestDownload()}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Manual Download
          </Button>
        </>
      );
    }

    return (
      <>
        <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-500" />
        <p className="text-center text-sm text-muted-foreground">{errorMsg}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" variant="outline" onClick={() => updater.check()}>
            Try Again
          </Button>
        </div>
      </>
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

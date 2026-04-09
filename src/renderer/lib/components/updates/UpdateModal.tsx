import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useEffect } from 'react';
import { EMDASH_RELEASES_URL } from '@shared/urls';
import { rpc } from '@renderer/lib/ipc';
import { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { formatBytes } from '@renderer/utils/formatBytes';

interface UpdateModalProps {
  onClose: () => void;
}

export function UpdateModalOverlay({ onClose }: BaseModalProps<void>) {
  return <UpdateModal onClose={onClose} />;
}

const UpdateModal = observer(function UpdateModal({
  onClose,
}: UpdateModalProps): React.JSX.Element {
  const update = appState.update;
  const appVersion = appState.appInfo.info.data?.appVersion;

  useEffect(() => {
    const { status } = update.state;
    if (status === 'idle' || status === 'not-available') {
      update.check();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Software Update</DialogTitle>
        <DialogDescription>
          Current version: v{appVersion || '...'} &middot;{' '}
          <button
            type="button"
            onClick={() => rpc.app.openExternal(EMDASH_RELEASES_URL)}
            className="inline-flex items-center gap-1 outline-none hover:text-foreground"
          >
            Changelog <ExternalLink className="h-3 w-3" />
          </button>
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4 py-4">
        {update.state.status === 'checking' && (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Checking for updates...</p>
          </>
        )}

        {(update.state.status === 'idle' || update.state.status === 'not-available') && (
          <>
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
            <p className="text-sm">Emdash is up to date.</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                OK
              </Button>
              <Button variant="outline" size="sm" onClick={() => update.check()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Check Again
              </Button>
            </div>
          </>
        )}

        {update.state.status === 'available' && (
          <>
            <Download className="h-8 w-8 text-primary" />
            <p className="text-sm text-muted-foreground">
              {update.state.info?.version
                ? `Version ${update.state.info.version} is available.`
                : 'An update is available.'}
            </p>
            <Button size="sm" onClick={() => update.download()}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download
            </Button>
          </>
        )}

        {update.state.status === 'downloading' && (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Downloading update{update.progressLabel ? ` (${update.progressLabel})` : '...'}
            </p>
            {update.state.progress && (
              <div className="w-full space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${update.state.progress.percent || 0}%` }}
                  />
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  {formatBytes(update.state.progress.transferred || 0)} /{' '}
                  {formatBytes(update.state.progress.total || 0)}
                </p>
              </div>
            )}
          </>
        )}

        {update.state.status === 'downloaded' && (
          <>
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
            <p className="text-sm">Update downloaded and ready to install.</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Later
              </Button>
              <Button size="sm" onClick={() => update.install()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Restart Now
              </Button>
            </div>
          </>
        )}

        {update.state.status === 'installing' && (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-center text-sm text-muted-foreground">
              Installing update. Emdash will close automatically when ready.
            </p>
          </>
        )}

        {update.state.status === 'error' && (
          <>
            <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-500" />
            <p className="text-center text-sm text-muted-foreground">
              {update.state.message || 'Update check failed'}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
              <Button size="sm" variant="outline" onClick={() => update.check()}>
                Try Again
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
});

import React, { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { useUpdater } from '@/hooks/useUpdater';
import { useToast } from '@/hooks/use-toast';

const VersionCard: React.FC = () => {
  const [electronVersion, setElectronVersion] = useState<string>('...');
  const [emdashVersion, setEmdashVersion] = useState<string>('...');
  const [platform, setPlatform] = useState<string>('');
  const { state: update, check, download, install, openLatest, progressLabel } = useUpdater();
  const { toast } = useToast();
  const userInitiatedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadVersionInfo = async () => {
      try {
        const [appVersion, electronVer, appPlatform] = await Promise.all([
          window.electronAPI.getAppVersion(),
          window.electronAPI.getElectronVersion(),
          window.electronAPI.getPlatform(),
        ]);
        if (!cancelled) {
          setEmdashVersion(appVersion);
          setElectronVersion(electronVer);
          setPlatform(appPlatform);
        }
      } catch (error) {
        console.error('Failed to load version info:', error);
        if (!cancelled) {
          setEmdashVersion('Unknown');
          setElectronVersion('Unknown');
        }
      }
    };

    loadVersionInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  // no-op local effects

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">emdash</span>
            <code className="font-mono text-sm text-muted-foreground">{emdashVersion}</code>
          </div>
        </div>

        <div className="flex-1 space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">Electron</span>
            <code className="font-mono text-sm text-muted-foreground">{electronVersion}</code>
          </div>
          {platform && <p className="text-xs text-muted-foreground">Platform: {platform}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {update.status === 'idle' || update.status === 'not-available' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              userInitiatedRef.current = true;
              await check();
            }}
          >
            Check for updates
          </Button>
        ) : null}

        {update.status === 'checking' ? (
          <Button size="sm" variant="outline" disabled aria-busy>
            <Spinner size="sm" className="mr-2" />
            Checking...
          </Button>
        ) : null}

        {update.status === 'available' ? (
          <Button size="sm" variant="outline" onClick={download}>
            Download update
          </Button>
        ) : null}

        {update.status === 'downloading' ? (
          <Button size="sm" variant="outline" disabled aria-busy>
            <Spinner size="sm" className="mr-2" />
            Downloading {progressLabel}
          </Button>
        ) : null}

        {update.status === 'downloaded' ? (
          <Button size="sm" variant="outline" onClick={install}>
            Restart and install
          </Button>
        ) : null}

        {update.status === 'error'
          ? (() => {
              const msg = update.message || '';
              const urlMatch = msg.match(/https?:\/\/\S+/);
              let manualUrl = urlMatch ? urlMatch[0] : '';
              // Sanitize common trailing tokens from logs (quotes, encoded quotes, brackets, commas, periods)
              manualUrl = manualUrl
                .replace(/(?:%22|%27|%60)+$/i, '') // strip encoded quotes/backticks at end
                .replace(/["'`]+$/g, '') // strip raw quotes/backticks at end
                .replace(/[\]\)\}\,\.]+$/, ''); // strip trailing ] ) } , .
              return (
                <div className="flex items-start gap-3">
                  <div className="inline-flex max-w-[520px] items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 shadow-sm">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-foreground">
                        Updater unavailable — download manually
                      </span>
                      {manualUrl ? (
                        <button
                          type="button"
                          className="text-left text-xs text-primary underline underline-offset-2"
                          onClick={() => window.electronAPI.openExternal(manualUrl)}
                          title={manualUrl}
                        >
                          Open exact download link
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={openLatest} className="self-start">
                    Get latest for your platform
                  </Button>
                </div>
              );
            })()
          : null}
      </div>

      {/* Notify user on manual check when already up to date */}
      {(() => {
        // Effect-like block: react hooks must be top-level; use a nested IIFE to keep file tidy
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useEffect(() => {
          if (update.status === 'not-available' && userInitiatedRef.current) {
            userInitiatedRef.current = false;
            try {
              toast({ title: 'You’re up to date', description: 'You are on the latest version.' });
            } catch {}
          }
          if (update.status !== 'checking' && update.status !== 'idle') {
            // Reset guard if state moves elsewhere without landing on not-available
            userInitiatedRef.current = false;
          }
        }, [update.status]);
        return null;
      })()}
    </div>
  );
};

export default VersionCard;

import React, { useMemo } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from './ui/alert-dialog';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { useTelemetryConsent } from '../hooks/useTelemetryConsent';
import { ArrowRight, ExternalLink, ShieldCheck } from 'lucide-react';

type FirstLaunchModalProps = {
  open: boolean;
  onClose: () => void;
};

const X_URL = 'https://x.com/rabanspiegel/status/1991220598538924097?s=20';
const YOUTUBE_EMBED_URL = 'https://www.youtube.com/embed/M22jhPRXASk?si=sYXqj0E8xwuyMXUT';

const FirstLaunchModal: React.FC<FirstLaunchModalProps> = ({ open, onClose }) => {
  const {
    prefEnabled,
    envDisabled,
    hasKeyAndHost,
    sessionRecordingOptIn,
    loading,
    setTelemetryEnabled,
    setSessionRecordingOptIn,
  } = useTelemetryConsent();

  const sessionDisabled = useMemo(
    () => loading || envDisabled || !hasKeyAndHost || !prefEnabled,
    [envDisabled, hasKeyAndHost, loading, prefEnabled]
  );

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent className="max-w-5xl border-border/70 bg-gradient-to-br from-background via-background/90 to-muted/60 shadow-2xl">
        <AlertDialogTitle className="text-center text-2xl font-semibold leading-tight">
          Welcome to Emdash
        </AlertDialogTitle>
        <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl border border-border/80 bg-black shadow-lg">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-amber-500/10" />
              <div className="relative aspect-video">
                <iframe
                  title="Emdash demo video"
                  src={YOUTUBE_EMBED_URL}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="absolute inset-0 h-full w-full border-0"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-1 text-xs"
                  onClick={() => window.electronAPI.openExternal?.(X_URL)}
                >
                  Watch on X
                  <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-background/90 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Help us improve Emdash</p>
                <p className="text-xs text-muted-foreground">
                  Share anonymized telemetry and optional session data so we can spot rough edges
                  sooner.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-muted/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <ShieldCheck className="h-3 w-3 text-primary" />
                  Masked
                </div>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium">Product usage (anonymous)</p>
                  <p className="text-[11px] text-muted-foreground">Safe defaults. No secrets.</p>
                </div>
                <Switch
                  checked={prefEnabled}
                  onCheckedChange={(checked) => void setTelemetryEnabled(checked)}
                  disabled={loading || envDisabled}
                  aria-label="Enable anonymous telemetry"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium">Session data (fully masked)</p>
                  <p className="text-[11px] text-muted-foreground">
                    Screen events only. Toggle anytime in Settings → Privacy.
                  </p>
                  {!hasKeyAndHost && (
                    <p className="text-[10px] text-muted-foreground">
                      Inactive in this build (missing PostHog keys).
                    </p>
                  )}
                </div>
                <Switch
                  checked={sessionRecordingOptIn}
                  onCheckedChange={(checked) => void setSessionRecordingOptIn(checked)}
                  disabled={sessionDisabled}
                  aria-label="Enable anonymous session data capture"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button type="button" onClick={onClose} className="gap-2">
                Start building
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default FirstLaunchModal;

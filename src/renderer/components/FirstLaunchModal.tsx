import React, { useEffect } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from './ui/alert-dialog';
import { Button } from './ui/button';
import { useTelemetryConsent } from '../hooks/useTelemetryConsent';
import { ArrowRight, ExternalLink } from 'lucide-react';

type FirstLaunchModalProps = {
  open: boolean;
  onClose: () => void;
};

const X_URL = 'https://x.com/rabanspiegel/status/1991220598538924097?s=20';
const YOUTUBE_EMBED_URL = 'https://www.youtube.com/embed/M22jhPRXASk?si=sYXqj0E8xwuyMXUT';

const FirstLaunchModal: React.FC<FirstLaunchModalProps> = ({ open, onClose }) => {
  const { prefEnabled, envDisabled, loading, setTelemetryEnabled } = useTelemetryConsent();

  useEffect(() => {
    if (!open) return;
    if (loading) return;
    if (envDisabled) return;
    if (!prefEnabled) void setTelemetryEnabled(true);
  }, [open, loading, envDisabled, prefEnabled, setTelemetryEnabled]);

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent className="max-w-3xl border-border/70 bg-gradient-to-br from-background via-background/90 to-muted/60 shadow-2xl">
        <AlertDialogTitle className="text-center text-2xl font-semibold leading-tight">
          Welcome to Emdash
        </AlertDialogTitle>
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-lg border border-border/80 bg-black shadow-lg">
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
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
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

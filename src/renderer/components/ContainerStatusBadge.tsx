import React from 'react';
import { Loader2, Square } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import dockerLogo from '../../assets/images/docker.png';

interface Props {
  active: boolean; // starting or ready
  isStarting: boolean;
  isReady: boolean;
  startingAction?: boolean; // starting request in-flight
  stoppingAction?: boolean; // stopping request in-flight
  onStart: (e: React.MouseEvent) => void | Promise<void>;
  onStop: (e: React.MouseEvent) => void | Promise<void>;
  showStop?: boolean; // optionally hide stop control (e.g., read-only view)
  taskPath?: string; // optional: used to detect compose and tweak tooltip copy
}

export const ContainerStatusBadge: React.FC<Props> = ({
  active,
  isStarting,
  isReady,
  startingAction = false,
  stoppingAction = false,
  onStart,
  onStop,
  showStop = true,
  taskPath,
}) => {
  const [hasCompose, setHasCompose] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!taskPath) return;
        const api: any = (window as any).electronAPI;
        const candidates = [
          'docker-compose.yml',
          'docker-compose.yaml',
          'compose.yml',
          'compose.yaml',
        ];
        for (const file of candidates) {
          const res = await api?.fsRead?.(taskPath, file, 1);
          if (!cancelled && res?.success) {
            setHasCompose(true);
            return;
          }
        }
        if (!cancelled) setHasCompose(false);
      } catch {
        if (!cancelled) setHasCompose(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskPath]);

  if (!active) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
              onClick={async (e) => {
                void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
                  captureTelemetry('container_connect_clicked');
                });
                await onStart(e);
              }}
              disabled={startingAction || hasCompose}
              aria-busy={startingAction}
              aria-label={
                hasCompose ? 'Compose containerization coming soon' : 'Connect to host machine'
              }
            >
              {startingAction ? (
                <>
                  Connecting
                  <Loader2 className="ml-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                </>
              ) : (
                <>
                  <img src={dockerLogo} alt="Docker" className="mr-1.5 h-3.5 w-3.5" />
                  Connect
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[22rem] text-xs leading-snug">
            {hasCompose
              ? 'Docker Compose (multi‑service) containerization is coming soon.'
              : 'Connect to host machine. Installs deps and maps declared ports for preview.'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (isStarting) {
    return (
      <span
        className="inline-flex h-8 items-center rounded-md border border-dashed border-border/70 bg-muted/40 px-2.5 text-xs font-medium text-foreground"
        aria-live="polite"
        aria-busy="true"
      >
        <img src={dockerLogo} alt="" className="mr-1.5 h-3.5 w-3.5" />
        Starting
        <Loader2 className="ml-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      </span>
    );
  }

  if (isReady) {
    return (
      <div
        className="inline-flex h-8 items-center overflow-hidden rounded-md border border-border/70 bg-background text-xs font-medium text-foreground"
        aria-live="polite"
        role="group"
      >
        <img src={dockerLogo} alt="" className="ml-2 mr-1.5 h-3.5 w-3.5" />
        <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        <span className="pr-2">Running</span>
        {showStop ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onStop}
                  disabled={stoppingAction}
                  className="h-8 px-2 text-muted-foreground transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
                  aria-label="Stop container"
                  title="Stop container"
                >
                  {stoppingAction ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Stop container
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
    );
  }
  return null;
};

export default ContainerStatusBadge;

import React from 'react';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { useTelemetryConsent } from '../hooks/useTelemetryConsent';

const TelemetryCard: React.FC = () => {
  const {
    prefEnabled,
    envDisabled,
    hasKeyAndHost,
    sessionRecordingOptIn,
    loading,
    setTelemetryEnabled,
    setSessionRecordingOptIn,
  } = useTelemetryConsent();

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Help improve Emdash by sending anonymous usage data.</p>
          <p>
            <span>See </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group inline-flex h-auto items-center gap-1 px-0 text-xs font-normal text-muted-foreground hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-0"
              onClick={() =>
                window.electronAPI.openExternal(
                  'https://github.com/generalaction/emdash/blob/main/docs/telemetry.md'
                )
              }
            >
              <span className="transition-colors group-hover:text-foreground">
                docs/telemetry.md
              </span>
              <span className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                ↗
              </span>
            </Button>
            <span> for details.</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={prefEnabled}
            onCheckedChange={(checked) => void setTelemetryEnabled(checked)}
            disabled={loading || envDisabled}
            aria-label="Enable anonymous telemetry"
          />
          {!hasKeyAndHost && (
            <span className="text-[10px] text-muted-foreground">
              Inactive in this build (no PostHog keys)
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 bg-muted/40 p-3">
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="text-xs text-muted-foreground">
            Optional session data capture (fully masked, anonymous).
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={sessionRecordingOptIn}
            onCheckedChange={(checked) => void setSessionRecordingOptIn(checked)}
            disabled={loading || envDisabled || !hasKeyAndHost || !prefEnabled}
            aria-label="Enable anonymous session data capture"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="group gap-2"
          onClick={() => window.electronAPI.openExternal('https://posthog.com/product')}
        >
          <span className="transition-colors group-hover:text-foreground">About PostHog</span>
          <span
            aria-hidden="true"
            className="text-xs text-muted-foreground transition-colors group-hover:text-foreground"
          >
            ↗
          </span>
        </Button>
      </div>
    </div>
  );
};

export default TelemetryCard;

import React from 'react';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { useTelemetryConsent } from '../hooks/useTelemetryConsent';

const TelemetryCard: React.FC = () => {
  const { prefEnabled, envDisabled, hasKeyAndHost, loading, setTelemetryEnabled } =
    useTelemetryConsent();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">Privacy & Telemetry</p>
        <div className="text-sm text-muted-foreground">
          <p>Help improve Emdash by sending anonymous usage data.</p>
          <p>
            <span>See </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group inline-flex h-auto items-center gap-1 px-0 text-sm font-normal text-muted-foreground hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-0"
              onClick={() =>
                window.electronAPI.openExternal('https://docs.emdash.sh/security/telemetry')
              }
            >
              <span className="transition-colors group-hover:text-foreground">
                Telemetry information
              </span>
              <span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                ↗
              </span>
            </Button>
            <span> for details.</span>
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Switch
          checked={prefEnabled}
          onCheckedChange={async (checked) => {
            void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
              captureTelemetry('telemetry_toggled', { enabled: checked });
            });
            void setTelemetryEnabled(checked);
          }}
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
  );
};

export default TelemetryCard;

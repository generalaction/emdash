import React from 'react';
import { useTelemetryConsent } from '@renderer/lib/hooks/useTelemetryConsent';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

const TelemetryCard: React.FC = () => {
  const { prefEnabled, envDisabled, hasKeyAndHost, loading, setTelemetryEnabled } =
    useTelemetryConsent();

  return (
    <SettingRow
      title="Privacy & Telemetry"
      description={
        <div>
          <p>Help improve Emdash by sending anonymous usage data.</p>
          <p>
            <span>See </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group inline-flex h-auto items-center gap-1 px-0 text-sm font-normal text-muted-foreground hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-0"
              onClick={() => rpc.app.openExternal('https://docs.emdash.sh/telemetry')}
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
      }
      control={
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={prefEnabled}
            onCheckedChange={async (checked) => {
              void import('../../../utils/telemetryClient').then(({ captureTelemetry }) => {
                captureTelemetry('setting_changed', { setting: 'telemetry' });
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
      }
    />
  );
};

export default TelemetryCard;

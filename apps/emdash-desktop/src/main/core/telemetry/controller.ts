import type { TelemetryEvent } from '@core/primitives/telemetry/api/telemetry';
import { telemetryService } from '@main/lib/telemetry';

export const telemetryOperations = {
  capture: (args: { event: TelemetryEvent; properties?: Record<string, unknown> }) => {
    telemetryService.capture(args.event, args.properties);
  },
  getStatus: () => {
    return { status: telemetryService.getTelemetryStatus() };
  },
  setEnabled: (enabled: boolean) => {
    telemetryService.setTelemetryEnabledViaUser(enabled);
  },
  getFeatureFlags: () => telemetryService.getFeatureFlags(),
};

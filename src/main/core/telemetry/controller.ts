import { telemetryService } from '@main/lib/telemetry';
import { createRPCController } from '@shared/lib/ipc/rpc';
import type { TelemetryEvent } from '@shared/telemetry';

export const telemetryController = createRPCController({
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
});

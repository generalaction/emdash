import { createRPCController } from '@shared/ipc/rpc';
import type { TelemetryEvent } from '@shared/telemetry';
import {
  capture,
  getTelemetryStatus,
  identify,
  setTelemetryEnabledViaUser,
} from '@main/lib/telemetry';

export const telemetryController = createRPCController({
  capture: (args: { event: TelemetryEvent; properties?: Record<string, unknown> }) => {
    capture(args.event, args.properties);
  },
  getStatus: () => {
    return { status: getTelemetryStatus() };
  },
  setEnabled: (enabled: boolean) => {
    setTelemetryEnabledViaUser(enabled);
  },
  identify: (username: string) => {
    identify(username);
  },
});

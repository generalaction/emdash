import { createController, type Controller } from '@emdash/wire/api';
import type { TelemetryEvent } from '@core/primitives/telemetry/api/telemetry';
import { telemetryService } from '@main/lib/telemetry';
import { telemetryContract } from '../api';

export function createTelemetryWireController(): Controller {
  return createController(telemetryContract, {
    capture: ({ event, properties }) => {
      telemetryService.capture(event as TelemetryEvent, properties);
    },
    getStatus: () => ({ status: telemetryService.getTelemetryStatus() }),
    setEnabled: ({ enabled }) => {
      telemetryService.setTelemetryEnabledViaUser(enabled);
    },
    getFeatureFlags: () => telemetryService.getFeatureFlags(),
  });
}

import { createController, type Controller } from '@emdash/wire/api';
import type { TelemetryEvent } from '@core/primitives/telemetry/api/telemetry';
import { telemetryOperations } from '@main/core/telemetry/controller';
import { telemetryContract } from '../api';

export function createTelemetryWireController(): Controller {
  return createController(telemetryContract, {
    capture: ({ event, properties }) =>
      telemetryOperations.capture({ event: event as TelemetryEvent, properties }),
    getStatus: () => telemetryOperations.getStatus(),
    setEnabled: ({ enabled }) => telemetryOperations.setEnabled(enabled),
    getFeatureFlags: () => telemetryOperations.getFeatureFlags(),
  });
}

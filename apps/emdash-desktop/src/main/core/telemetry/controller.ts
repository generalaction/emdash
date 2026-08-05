import { telemetryService } from '@main/lib/telemetry';
import { createRPCController } from '@shared/lib/ipc/rpc';
import type { TelemetryEvent, TelemetryExceptionReport } from '@shared/telemetry';

export const telemetryController = createRPCController({
  capture: (args: { event: TelemetryEvent; properties?: Record<string, unknown> }) => {
    telemetryService.capture(args.event, args.properties);
  },
  captureException: (report: TelemetryExceptionReport) => {
    const error = new Error(report.message);
    error.name = report.name;
    if (report.stack) error.stack = report.stack;
    telemetryService.captureException(error, {
      process_type: 'renderer',
      mechanism: report.mechanism,
      ...(report.componentStack ? { component_stack: report.componentStack } : {}),
    });
  },
  getStatus: () => {
    return { status: telemetryService.getTelemetryStatus() };
  },
  setEnabled: (enabled: boolean) => telemetryService.setTelemetryEnabledViaUser(enabled),
  getFeatureFlags: () => telemetryService.getFeatureFlags(),
});

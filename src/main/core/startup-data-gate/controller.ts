import { createRPCController } from '@shared/ipc/rpc';
import type { ResolveStartupDataGateActionArgs } from '@shared/startup-data-gate';
import { startupDataGateService } from './service';

export const startupDataGateController = createRPCController({
  getState: () => startupDataGateService.getState(),
  resolveAction: (args: ResolveStartupDataGateActionArgs) =>
    startupDataGateService.resolveAction(args),
});

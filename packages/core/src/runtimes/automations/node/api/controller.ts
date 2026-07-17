import { createController, type Controller } from '@emdash/wire';
import { automationsContract } from '../../api/contract';
import type { AutomationsRuntime } from '../runtime';

export function createAutomationsController(runtime: AutomationsRuntime): Controller {
  return createController(automationsContract, {
    deploy: (input) => runtime.deploy(input),
    remove: (input) => runtime.remove(input),
    startRun: (input) => runtime.startRun(input),
    cancelRun: (input) => runtime.cancelRun(input),
    getRuns: (input) => runtime.getRuns(input),
    runEvents: runtime.runEventsHost,
  });
}

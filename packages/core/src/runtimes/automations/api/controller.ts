import { createController, type Controller } from '@emdash/wire';
import type { AutomationsRuntime } from '../node/runtime';
import { automationsContract } from './contract';

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

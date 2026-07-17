import { createController, type Controller } from '@emdash/wire';
import { automationsContract } from '../../api/contract';
import type { AutomationsRuntime } from '../runtime';

export function createAutomationsController(runtime: AutomationsRuntime): Controller {
  return createController(automationsContract, {
    deploy: (input) => runtime.deploy(input),
    remove: (input) => runtime.remove(input),
    startRun: (input) => runtime.startRun(input),
    cancelRun: (input) => runtime.cancelRun(input),
    getRun: (input) => runtime.getRun(input),
    listRuns: (input) => runtime.listRuns(input),
    listChangedRuns: (input) => runtime.listChangedRuns(input),
    getRunOverview: (input) => runtime.getRunOverview(input),
    runEvents: runtime.runEventsHost,
  });
}

import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';
import { workspaceComponent } from './component';

const logger = initWorkerProcessLogging('workspace-runtime');
void runWireComponentWorker(workspaceComponent, { logger });

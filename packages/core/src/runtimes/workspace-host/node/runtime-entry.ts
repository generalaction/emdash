import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';
import { workspaceHostComponent } from './component';

const logger = initWorkerProcessLogging('workspace-host-runtime');
void runWireComponentWorker(workspaceHostComponent, { logger });

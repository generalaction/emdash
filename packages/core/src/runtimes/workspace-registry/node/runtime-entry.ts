import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { workspaceRegistryComponent } from './component';

const logger = initWorkerProcessLogging('workspace-registry-runtime');
void runWireComponentWorker(workspaceRegistryComponent, { logger });

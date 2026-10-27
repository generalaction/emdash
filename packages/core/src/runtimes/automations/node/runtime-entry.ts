import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { createAutomationsComponent } from './component';

const logger = initWorkerProcessLogging('automations-runtime');
void runWireComponentWorker(createAutomationsComponent(), { logger });

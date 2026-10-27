import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';
import { createAutomationsComponent } from './component';

const logger = initWorkerProcessLogging('automations-runtime');
void runWireComponentWorker(createAutomationsComponent(), { logger });

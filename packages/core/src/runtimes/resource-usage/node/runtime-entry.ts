import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { resourceUsageComponent } from './component';

const logger = initWorkerProcessLogging('resource-usage-runtime');
void runWireComponentWorker(resourceUsageComponent, { logger });

import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { scriptsComponent } from './component';

const logger = initWorkerProcessLogging('scripts-runtime');
void runWireComponentWorker(scriptsComponent, { logger });

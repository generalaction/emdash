import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { terminalsComponent } from './component';

const logger = initWorkerProcessLogging('terminals-runtime');
void runWireComponentWorker(terminalsComponent, { logger });

import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { filesComponent } from './component';

const logger = initWorkerProcessLogging('files-runtime');
void runWireComponentWorker(filesComponent, { logger });

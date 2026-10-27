import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { fsWatchComponent } from './component';

const logger = initWorkerProcessLogging('fs-watch-runtime');
void runWireComponentWorker(fsWatchComponent, { logger });

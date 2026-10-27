import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { gitComponent } from './component';

const logger = initWorkerProcessLogging('git-runtime');
void runWireComponentWorker(gitComponent, { logger });

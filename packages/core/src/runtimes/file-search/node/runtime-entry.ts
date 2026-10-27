import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { fileSearchComponent } from './component';

const logger = initWorkerProcessLogging('file-search-runtime');
void runWireComponentWorker(fileSearchComponent, { logger });

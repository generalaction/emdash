import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { conversationsComponent } from './component';

const logger = initWorkerProcessLogging('conversations-runtime');
void runWireComponentWorker(conversationsComponent, { logger });

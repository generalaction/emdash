import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { lspComponent } from './component';

void runWireComponentWorker(lspComponent, { logger: initWorkerProcessLogging('lsp-runtime') });

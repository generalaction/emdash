import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';
import { lspComponent } from './component';

void runWireComponentWorker(lspComponent, { logger: initWorkerProcessLogging('lsp-runtime') });

import { fileSearchComponent } from '@emdash/core/runtimes/file-search/node';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-file-search-runtime' });

void runWireComponentWorker(fileSearchComponent, { logger });

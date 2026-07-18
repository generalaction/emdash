import { filesComponent } from '@emdash/core/runtimes/files/node';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-files-runtime' });

void runWireComponentWorker(filesComponent, { logger });

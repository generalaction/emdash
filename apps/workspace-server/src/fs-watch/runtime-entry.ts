import { fsWatchComponent } from '@emdash/core/services/fs-watch/node';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-fs-watch-runtime' });

void runWireComponentWorker(fsWatchComponent, { logger });

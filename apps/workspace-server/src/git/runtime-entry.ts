import { gitComponent } from '@emdash/core/runtimes/git/node';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-git-runtime' });

void runWireComponentWorker(gitComponent, { logger });

import { workspaceComponent } from '@emdash/core/runtimes/workspace/node';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-runtime' });

void runWireComponentWorker(workspaceComponent, { logger });

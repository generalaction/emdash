import { terminalsComponent } from '@emdash/core/runtimes/terminals/node';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-terminals-runtime' });

void runWireComponentWorker(terminalsComponent, { logger });

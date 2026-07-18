import { createAutomationsComponent } from '@emdash/core/runtimes/automations/node';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-automations-runtime' });

void runWireComponentWorker(createAutomationsComponent(), { logger });

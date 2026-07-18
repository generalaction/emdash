import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-acp-runtime' });

void runWireComponentWorker(createAcpComponent({ pluginRegistry }), { logger });

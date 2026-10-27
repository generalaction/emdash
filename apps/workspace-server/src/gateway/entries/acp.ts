import { createAcpComponent } from '@agent/core/runtimes/acp/node';
import { pluginRegistry } from '@agent/plugins/agents';
import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';

const logger = initWorkerProcessLogging('acp-runtime');
void runWireComponentWorker(createAcpComponent({ pluginRegistry }), { logger });

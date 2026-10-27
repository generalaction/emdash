import { createAgentConfigComponent } from '@agent/core/runtimes/agent-config/node';
import { pluginRegistry } from '@agent/plugins/agents';
import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';

const logger = initWorkerProcessLogging('agent-config-runtime');
void runWireComponentWorker(createAgentConfigComponent({ pluginRegistry }), { logger });

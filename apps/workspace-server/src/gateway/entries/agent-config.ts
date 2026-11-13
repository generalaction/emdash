import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { applyConfiguredAgentInstancesFromEnv } from '@emdash/plugins/agents/configured-instances';
import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';

const logger = initWorkerProcessLogging('agent-config-runtime');
applyConfiguredAgentInstancesFromEnv(logger);
void runWireComponentWorker(createAgentConfigComponent({ pluginRegistry }), { logger });

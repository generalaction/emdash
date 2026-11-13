import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { applyConfiguredAgentInstancesFromEnv } from '@emdash/plugins/agents/configured-instances';
import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';

const logger = initWorkerProcessLogging('acp-runtime');
applyConfiguredAgentInstancesFromEnv(logger);
void runWireComponentWorker(createAcpComponent({ pluginRegistry }), { logger });

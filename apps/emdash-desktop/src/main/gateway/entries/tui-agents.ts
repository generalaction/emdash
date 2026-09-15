import { createTuiAgentsComponent } from '@emdash/core/runtimes/tui-agents/node';
import { applyConfiguredAgentInstancesFromEnv, pluginRegistry } from '@emdash/plugins/agents';
import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';

const logger = initWorkerProcessLogging('tui-agents-runtime');
applyConfiguredAgentInstancesFromEnv(logger);
void runWireComponentWorker(createTuiAgentsComponent({ pluginRegistry }), { logger });

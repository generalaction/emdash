import { createTuiAgentsComponent } from '@emdash/core/runtimes/tui-agents/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { applyConfiguredAgentInstancesFromEnv } from '@emdash/plugins/agents/configured-instances';
import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';

const logger = initWorkerProcessLogging('tui-agents-runtime');
applyConfiguredAgentInstancesFromEnv(logger);
void runWireComponentWorker(createTuiAgentsComponent({ pluginRegistry }), { logger });

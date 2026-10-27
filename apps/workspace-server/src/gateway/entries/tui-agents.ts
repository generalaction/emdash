import { createTuiAgentsComponent } from '@agent/core/runtimes/tui-agents/node';
import { pluginRegistry } from '@agent/plugins/agents';
import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';

const logger = initWorkerProcessLogging('tui-agents-runtime');
void runWireComponentWorker(createTuiAgentsComponent({ pluginRegistry }), { logger });

import { createTuiAgentsComponent } from '@emdash/core/runtimes/tui-agents/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-tui-agents-runtime' });

void runWireComponentWorker(createTuiAgentsComponent({ pluginRegistry }), { logger });

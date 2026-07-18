import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

const logger = initProcessLogging({ name: 'workspace-agent-config-runtime' });

void runWireComponentWorker(createAgentConfigComponent({ pluginRegistry }), { logger });

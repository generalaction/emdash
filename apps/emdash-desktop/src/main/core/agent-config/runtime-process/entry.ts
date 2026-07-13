import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import { runWireComponentWorker } from '@emdash/wire/worker';
import { pluginRegistry } from '@emdash/plugins/agents';

void runWireComponentWorker(createAgentConfigComponent({ pluginRegistry }));

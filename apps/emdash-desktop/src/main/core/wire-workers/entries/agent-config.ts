import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { runWireComponentWorker } from '@emdash/wire/worker';

void runWireComponentWorker(createAgentConfigComponent({ pluginRegistry }));

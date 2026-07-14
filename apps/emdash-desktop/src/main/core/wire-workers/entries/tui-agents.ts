import { createTuiAgentsComponent } from '@emdash/core/runtimes/tui-agents/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { runWireComponentWorker } from '@emdash/wire/worker';

void runWireComponentWorker(createTuiAgentsComponent({ pluginRegistry }));

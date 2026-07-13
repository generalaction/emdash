import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import { runWireComponentWorker } from '@emdash/wire/worker';
import { pluginRegistry } from '@emdash/plugins/agents';

void runWireComponentWorker(createAcpComponent({ pluginRegistry }));

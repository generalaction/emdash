import { createProviderUsageComponent } from '@emdash/core/runtimes/provider-usage/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { runWireComponentWorker } from '@emdash/wire/worker';
import { initWorkerProcessLogging } from '@emdash/wire/worker/node';

const logger = initWorkerProcessLogging('provider-usage-runtime');
void runWireComponentWorker(createProviderUsageComponent({ pluginRegistry }), { logger });

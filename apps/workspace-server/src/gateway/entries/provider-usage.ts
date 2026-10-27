import { createProviderUsageComponent } from '@agent/core/runtimes/provider-usage/node';
import { pluginRegistry } from '@agent/plugins/agents';
import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';

const logger = initWorkerProcessLogging('provider-usage-runtime');
void runWireComponentWorker(createProviderUsageComponent({ pluginRegistry }), { logger });

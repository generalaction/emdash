import { runWireComponentWorker } from '@agent/wire/worker';
import { initWorkerProcessLogging } from '@agent/wire/worker/node';
import { hostSettingsComponent } from './component';

const logger = initWorkerProcessLogging('host-settings-runtime');
void runWireComponentWorker(hostSettingsComponent, { logger });

import { createAutomationsComponent } from '@emdash/core/runtimes/automations/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

void runWireComponentWorker(createAutomationsComponent());

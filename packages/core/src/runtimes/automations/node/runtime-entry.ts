import { runWireComponentWorker } from '@emdash/wire/worker';
import { createAutomationsComponent } from './component';

void runWireComponentWorker(createAutomationsComponent());

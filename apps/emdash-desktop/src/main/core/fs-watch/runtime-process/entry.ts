import { fsWatchComponent } from '@emdash/core/services/fs-watch/node';
import { runWireComponentWorker } from '@emdash/wire/worker';

void runWireComponentWorker(fsWatchComponent);

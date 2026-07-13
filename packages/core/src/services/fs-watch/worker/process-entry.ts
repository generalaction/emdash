import { initProcessLogging } from '@emdash/shared/logger/node';
import { validation } from '@emdash/wire/api';
import { serveWireWorker, workerValidatePolicy, type WorkerParentPort } from '@emdash/wire/worker';
import { fsWatchContract } from '@services/fs-watch/api';
import { createFsWatchController } from '@services/fs-watch/impl/controller';

export type RunFsWatchWorkerProcessOptions = {
  env?: NodeJS.ProcessEnv;
  port?: WorkerParentPort;
  exit?: (code: number) => void;
};

export function runFsWatchWorkerProcess(options: RunFsWatchWorkerProcessOptions = {}): void {
  const env = options.env ?? process.env;
  const logger = initProcessLogging({ name: 'fs-watch-runtime', env });

  void serveWireWorker(
    ({ scope }) =>
      createFsWatchController({
        scope: scope.child('fs-watch-runtime'),
        onError: (context, error) => logger.warn(context, { error }),
      }),
    {
      port: options.port,
      exit: options.exit,
      logger,
      middleware: [validation(fsWatchContract, workerValidatePolicy(env))],
    }
  );
}

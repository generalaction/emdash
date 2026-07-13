import { initProcessLogging } from '@emdash/shared/logger/node';
import { validation } from '@emdash/wire/api';
import { serveWireWorker, workerValidatePolicy, type WorkerParentPort } from '@emdash/wire/worker';
import { filesContract, type FilesContract } from '@runtimes/files/api';
import { createFilesController } from '@runtimes/files/node/api/controller';
import { FilesRuntime, type FilesRuntimeOptions } from '@runtimes/files/node/files-runtime';

export type BootFilesRuntimeProcessOptions = {
  contract?: FilesContract;
  env?: NodeJS.ProcessEnv;
  port?: WorkerParentPort;
  exit?: (code: number) => void;
  runtime?: Omit<FilesRuntimeOptions, 'watcher'>;
};

export function bootFilesRuntimeProcess(options: BootFilesRuntimeProcessOptions = {}): void {
  const env = options.env ?? process.env;
  const contract = options.contract ?? filesContract;
  const logger = initProcessLogging({ name: 'files-runtime', env });

  void serveWireWorker(
    ({ scope }) => {
      const runtime = new FilesRuntime({
        ...options.runtime,
        onError: (context, error) => logger.warn(context, { error }),
      });
      scope.add(() => runtime.dispose());
      return createFilesController(runtime, {
        contract,
        validate: 'none',
      });
    },
    {
      port: options.port,
      exit: options.exit,
      logger,
      middleware: [validation(contract, workerValidatePolicy(env))],
    }
  ).catch((error: unknown) => {
    logger.error('files runtime process failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    (options.exit ?? process.exit)(1);
  });
}

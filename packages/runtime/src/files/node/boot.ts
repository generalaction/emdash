import { filesContract, type FilesContract } from '@emdash/core/files';
import { initProcessLogging } from '@emdash/shared/logger/node';
import type { ValidatePolicy } from '@emdash/wire';
import { serveProcessRuntime, type ProcessRuntimePort } from '@emdash/wire/util/process-runtime';
import { createFilesController } from '../api/controller';
import { FilesRuntime, type FilesRuntimeOptions } from '../files-runtime';

export type BootFilesRuntimeProcessOptions = {
  contract?: FilesContract;
  env?: NodeJS.ProcessEnv;
  port?: ProcessRuntimePort;
  exit?: (code: number) => void;
  runtime?: Omit<FilesRuntimeOptions, 'watcher'>;
};

export function bootFilesRuntimeProcess(options: BootFilesRuntimeProcessOptions = {}): void {
  const env = options.env ?? process.env;
  const contract = options.contract ?? filesContract;
  const logger = initProcessLogging({ name: 'files-runtime', env });

  void serveProcessRuntime(
    (scope) => {
      const runtime = new FilesRuntime({
        ...options.runtime,
        onError: (context, error) => logger.warn(context, { error }),
      });
      scope.add(() => runtime.dispose());
      return createFilesController(runtime, {
        contract,
        validate: runtimeWireValidationPolicy(env),
      });
    },
    { port: options.port, exit: options.exit, logger }
  ).catch((error: unknown) => {
    logger.error('files runtime process failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    (options.exit ?? process.exit)(1);
  });
}

function runtimeWireValidationPolicy(env: NodeJS.ProcessEnv): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

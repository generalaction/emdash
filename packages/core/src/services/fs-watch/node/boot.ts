import { initProcessLogging } from '@emdash/shared/logger/node';
import { withValidation, type ValidatePolicy } from '@emdash/wire/api';
import { serveProcessRuntime, type ProcessRuntimePort } from '@emdash/wire/util/process-runtime';
import { fsWatchContract } from '../contract';
import { createFsWatchController } from '../controller';

export type BootFsWatchProcessOptions = {
  env?: NodeJS.ProcessEnv;
  port?: ProcessRuntimePort;
  exit?: (code: number) => void;
};

export function bootFsWatchProcess(options: BootFsWatchProcessOptions = {}): void {
  const env = options.env ?? process.env;
  const logger = initProcessLogging({ name: 'fs-watch-runtime', env });

  void serveProcessRuntime(
    (scope) =>
      withValidation(
        fsWatchContract,
        createFsWatchController({
          scope: scope.child('fs-watch-runtime'),
          onError: (context, error) => logger.warn(context, { error }),
        }),
        runtimeWireValidationPolicy(env)
      ),
    { port: options.port, exit: options.exit, logger }
  ).catch((error: unknown) => {
    logger.error('Fs-watch runtime process failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    (options.exit ?? process.exit)(1);
  });
}

function runtimeWireValidationPolicy(env: NodeJS.ProcessEnv): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

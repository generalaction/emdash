import { gitContract, type GitContract } from '@emdash/core/git';
import { initProcessLogging } from '@emdash/shared/logger/node';
import {
  serveWorkerProcess,
  workerValidatePolicy,
  type ProcessRuntimePort,
} from '@emdash/wire/util/process-runtime';
import { createGitController } from '../api/controller';
import { GitRuntime, type GitRuntimeOptions } from '../git-runtime';

export type BootGitRuntimeProcessOptions = {
  contract?: GitContract;
  env?: NodeJS.ProcessEnv;
  port?: ProcessRuntimePort;
  exit?: (code: number) => void;
  runtime?: Omit<GitRuntimeOptions, 'watcher'>;
};

export function bootGitRuntimeProcess(options: BootGitRuntimeProcessOptions = {}): void {
  const env = options.env ?? process.env;
  const contract = options.contract ?? gitContract;
  const logger = initProcessLogging({ name: 'git-runtime', env });

  void serveWorkerProcess(
    (scope) => {
      const runtime = new GitRuntime({
        ...options.runtime,
        env: options.runtime?.env ?? env,
        onError: (context, error) => logger.warn(context, { error }),
      });
      scope.add(() => runtime.dispose());
      return createGitController(runtime, {
        contract,
        validate: workerValidatePolicy(env),
      });
    },
    { port: options.port, exit: options.exit, logger }
  ).catch((error: unknown) => {
    logger.error('git runtime process failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    (options.exit ?? process.exit)(1);
  });
}

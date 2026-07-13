import { initProcessLogging } from '@emdash/shared/logger/node';
import { validation } from '@emdash/wire/api';
import { serveWireWorker, workerValidatePolicy, type WorkerParentPort } from '@emdash/wire/worker';
import { gitContract, type GitContract } from '@runtimes/git/api';
import { createGitController } from '@runtimes/git/node/api/controller';
import { GitRuntime, type GitRuntimeOptions } from '@runtimes/git/node/git-runtime';

export type BootGitRuntimeProcessOptions = {
  contract?: GitContract;
  env?: NodeJS.ProcessEnv;
  port?: WorkerParentPort;
  exit?: (code: number) => void;
  runtime?: Omit<GitRuntimeOptions, 'watcher'>;
};

export function bootGitRuntimeProcess(options: BootGitRuntimeProcessOptions = {}): void {
  const env = options.env ?? process.env;
  const contract = options.contract ?? gitContract;
  const logger = initProcessLogging({ name: 'git-runtime', env });

  void serveWireWorker(
    ({ scope }) => {
      const runtime = new GitRuntime({
        ...options.runtime,
        env: options.runtime?.env ?? env,
        onError: (context, error) => logger.warn(context, { error }),
      });
      scope.add(() => runtime.dispose());
      return createGitController(runtime, {
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
    logger.error('git runtime process failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    (options.exit ?? process.exit)(1);
  });
}

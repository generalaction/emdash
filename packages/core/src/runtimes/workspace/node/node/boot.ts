import { initProcessLogging } from '@emdash/shared/logger/node';
import { validation } from '@emdash/wire/api';
import { serveWireWorker, workerValidatePolicy, type WorkerParentPort } from '@emdash/wire/worker';
import { workspaceContract, type WorkspaceContract } from '@runtimes/workspace/api';
import { createWorkspaceController } from '@runtimes/workspace/node/api/controller';
import {
  WorkspaceRuntime,
  type WorkspaceRuntimeOptions,
} from '@runtimes/workspace/node/workspace-runtime';

export type BootWorkspaceRuntimeProcessOptions = {
  contract?: WorkspaceContract;
  env?: NodeJS.ProcessEnv;
  port?: WorkerParentPort;
  exit?: (code: number) => void;
  runtime?: Omit<WorkspaceRuntimeOptions, 'watcher'>;
};

export function bootWorkspaceRuntimeProcess(
  options: BootWorkspaceRuntimeProcessOptions = {}
): void {
  const env = options.env ?? process.env;
  const contract = options.contract ?? workspaceContract;
  const logger = initProcessLogging({ name: 'workspace-runtime', env });

  void serveWireWorker(
    ({ scope }) => {
      const runtime = new WorkspaceRuntime({
        ...options.runtime,
        scope,
        onError: (context, error) => logger.warn(context, { error }),
      });
      return createWorkspaceController(runtime, {
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
    logger.error('workspace runtime process failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    (options.exit ?? process.exit)(1);
  });
}

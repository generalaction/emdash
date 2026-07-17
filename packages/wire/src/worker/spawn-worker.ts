import type { Unsubscribe } from '@emdash/shared';
import type { ContractClient } from '../api/client';
import type { Connection } from '../api/connect';
import type { Contract, ContractDefinitions } from '../api/define';
import type { WireInstrumentation } from '../observability';
import type {
  ManagedProcess,
  ProcessExit,
  ProcessHost,
  ProcessSpec,
  ProcessSupervision,
} from '../process';
import { childProcessHost } from '../process/node';
import { createScope, type Scope } from '../util';
import { forwardRuntimeLogs, spawnRuntime } from '../util/process-runtime';

const DEFAULT_SUPERVISION: ProcessSupervision = {
  restart: 'on-failure',
  backoffMs: [250, 1_000, 2_500],
  maxRestarts: 5,
};

export type WorkerSpec<Defs extends ContractDefinitions> = {
  name: string;
  contract: Contract<Defs>;
  entry: string;
  scope?: Scope;
  env?: Record<string, string | undefined>;
  host?: ProcessHost;
  supervision?: ProcessSupervision;
  instrumentation?: WireInstrumentation;
  readyTimeoutMs?: number;
};

export type WorkerHandle<Defs extends ContractDefinitions> = {
  readonly client: ContractClient<Defs>;
  readonly connection: Connection;
  readonly process: ManagedProcess;
  readonly scope: Scope;
  readonly whenExited: Promise<ProcessExit>;
  onRestarted(cb: () => void): Unsubscribe;
  dispose(): Promise<void>;
};

export async function spawnWorker<Defs extends ContractDefinitions>(
  spec: WorkerSpec<Defs>
): Promise<WorkerHandle<Defs>> {
  const scope = spec.scope
    ? spec.scope.child(`worker:${spec.name}`)
    : createScope({
        label: `worker:${spec.name}`,
      });
  const logger = scope.log;
  const source = `${spec.name}-runtime`;

  try {
    logger.info('worker process entry resolved', { entry: spec.entry });
    const runtime = await spawnRuntime({
      host: spec.host ?? childProcessHost(),
      contract: spec.contract,
      scope,
      instrumentation: spec.instrumentation,
      readyTimeoutMs: spec.readyTimeoutMs,
      spec: toRuntimeSpec(spec),
      onProcess(process) {
        scope.add(forwardRuntimeLogs(process, logger, { source }));
        scope.add(
          process.onExit((exit) => {
            const level = exit.willRestart ? 'warn' : exit.code ? 'error' : 'info';
            logger[level]('worker process exited', exit);
          })
        );
      },
    });

    scope.add(runtime.onRestarted(() => logger.info('worker process restarted')));

    return {
      client: runtime.client,
      connection: runtime.connection,
      process: runtime.process,
      scope,
      whenExited: waitForTerminalExit(runtime.process, scope),
      onRestarted: (cb) => runtime.onRestarted(cb),
      dispose: () => scope.dispose(),
    };
  } catch (error) {
    await scope.dispose();
    throw error;
  }
}

function toRuntimeSpec<Defs extends ContractDefinitions>(spec: WorkerSpec<Defs>): ProcessSpec {
  return {
    entry: spec.entry,
    env: spec.env,
    supervision: spec.supervision ?? DEFAULT_SUPERVISION,
  };
}

function waitForTerminalExit(process: ManagedProcess, scope: Scope): Promise<ProcessExit> {
  return new Promise((resolve) => {
    scope.add(
      process.onExit((exit) => {
        if (!exit.willRestart) resolve({ code: exit.code, signal: exit.signal });
      })
    );
  });
}

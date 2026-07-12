import type { Unsubscribe } from '@emdash/shared';
import type { Scope } from '../../util';
import { listen, type EventEmitterLike } from '../events';
import type { ProcessExit, WorkerProcess, WorkerProcessSpawner, WorkerProcessSpec } from '../types';

export type UtilityProcessForkOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type UtilityProcessLike = EventEmitterLike & {
  readonly pid?: number;
  postMessage(message: unknown): void;
  kill(): void;
  stdout?: EventEmitterLike;
  stderr?: EventEmitterLike;
};

export type UtilityForkLike = (
  entry: string,
  args?: string[],
  options?: UtilityProcessForkOptions
) => UtilityProcessLike;

export function utilityProcessSpawner(deps: { fork: UtilityForkLike }): WorkerProcessSpawner {
  return {
    async spawn(spec: WorkerProcessSpec, _scope: Scope): Promise<WorkerProcess> {
      return spawnUtilityProcess(deps, spec);
    },
  };
}

function spawnUtilityProcess(
  deps: { fork: UtilityForkLike },
  spec: WorkerProcessSpec
): WorkerProcess {
  const process = deps.fork(spec.entry, [...(spec.args ?? [])], {
    cwd: spec.cwd,
    env: spec.env,
  });

  return {
    get pid() {
      return process.pid;
    },
    send(message) {
      process.postMessage(message);
    },
    onMessage(cb): Unsubscribe {
      return listen(process, 'message', (message) => cb(message));
    },
    onExit(cb): Unsubscribe {
      return listen(process, 'exit', (code, signal) => cb(toProcessExit(code, signal)));
    },
    onStdio(cb): Unsubscribe {
      const unsubscribeStdout = listen(process.stdout, 'data', (chunk) =>
        cb('stdout', stringifyChunk(chunk))
      );
      const unsubscribeStderr = listen(process.stderr, 'data', (chunk) =>
        cb('stderr', stringifyChunk(chunk))
      );
      return () => {
        unsubscribeStdout();
        unsubscribeStderr();
      };
    },
    kill(): void {
      process.kill();
    },
  };
}

function toProcessExit(code: unknown, signal: unknown): ProcessExit {
  return {
    code: typeof code === 'number' ? code : null,
    signal: typeof signal === 'string' ? signal : null,
  };
}

function stringifyChunk(chunk: unknown): string {
  return typeof chunk === 'string' ? chunk : String(chunk);
}

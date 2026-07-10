import { fork, type ChildProcess } from 'node:child_process';
import type { Unsubscribe } from '@emdash/shared';
import type { Scope } from '../../util';
import { listen, type EventEmitterLike } from '../events';
import { createSupervisedProcess } from '../supervisor';
import type { ChildHandle, ManagedProcess, ProcessExit, ProcessHost, ProcessSpec } from '../types';

export function childProcessHost(): ProcessHost {
  return {
    spawn(spec, scope): Promise<ManagedProcess> {
      return createSupervisedProcess(spec, spawnChildProcess, scope);
    },
  };
}

function spawnChildProcess(spec: ProcessSpec, _scope: Scope): ChildHandle {
  const child = fork(spec.entry, spec.args ?? [], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // Structured-clone (V8) serialization preserves `undefined` values, typed
    // arrays, and Dates across the IPC channel, matching the semantics wire
    // payloads were designed for. The default JSON mode drops `undefined`
    // object properties, which breaks Result<void> payloads.
    serialization: 'advanced',
  });

  return {
    get pid() {
      return child.pid;
    },
    send(message) {
      child.send(message as Parameters<ChildProcess['send']>[0]);
    },
    onMessage(cb): Unsubscribe {
      return listen(child as unknown as EventEmitterLike, 'message', (message) => cb(message));
    },
    onExit(cb): Unsubscribe {
      return listen(child as unknown as EventEmitterLike, 'exit', (code, signal) =>
        cb(toProcessExit(code, signal))
      );
    },
    onStdio(cb): Unsubscribe {
      return listenToStdio(child, cb);
    },
    kill(): void {
      child.kill('SIGKILL');
    },
  };
}

function listenToStdio(
  child: ChildProcess,
  cb: (stream: 'stdout' | 'stderr', chunk: string) => void
): Unsubscribe {
  const unsubscribeStdout = listen(
    child.stdout as unknown as EventEmitterLike | undefined,
    'data',
    (chunk) => cb('stdout', stringifyChunk(chunk))
  );
  const unsubscribeStderr = listen(
    child.stderr as unknown as EventEmitterLike | undefined,
    'data',
    (chunk) => cb('stderr', stringifyChunk(chunk))
  );
  return () => {
    unsubscribeStdout();
    unsubscribeStderr();
  };
}

function toProcessExit(code: unknown, signal: unknown): ProcessExit {
  return {
    code: typeof code === 'number' ? code : null,
    signal: typeof signal === 'string' ? signal : null,
  };
}

function stringifyChunk(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
  return String(chunk);
}

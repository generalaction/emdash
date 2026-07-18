import { Emitter, type Unsubscribe } from '@emdash/shared';
import type { LogFields, LogLevel, Logger } from '@emdash/shared/logger';
import { client, type ContractClient } from '../../api/client';
import { connect, type Connection } from '../../api/connect';
import type { Controller } from '../../api/controller';
import type { Contract, ContractDefinitions } from '../../api/define';
import { isWireMessage, type WireTransport } from '../../api/protocol';
import { serve, type ServeOptions } from '../../api/serve';
import type { ValidatePolicy } from '../../api/with-validation';
import type { WireInstrumentation } from '../../observability';
import type { ManagedProcess, ProcessHost, ProcessSpec } from '../../process/types';
import { createScope, type Scope } from '../scope';

const RUNTIME_SIGNAL_KIND = 'wire-runtime-signal';
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;

type RuntimeSignal = {
  kind: typeof RUNTIME_SIGNAL_KIND;
  event: 'ready' | 'shutdown';
};

const READY_SIGNAL: RuntimeSignal = { kind: RUNTIME_SIGNAL_KIND, event: 'ready' };

export const RUNTIME_SHUTDOWN_SIGNAL: RuntimeSignal = {
  kind: RUNTIME_SIGNAL_KIND,
  event: 'shutdown',
};

export type SpawnRuntimeOptions<Defs extends ContractDefinitions> = {
  host: ProcessHost;
  contract: Contract<Defs>;
  spec: ProcessSpec;
  scope?: Scope;
  readyTimeoutMs?: number;
  instrumentation?: WireInstrumentation;
  onProcess?: (process: ManagedProcess) => void;
};

export type RuntimeHandle<Defs extends ContractDefinitions> = {
  readonly client: ContractClient<Defs>;
  readonly connection: Connection;
  readonly process: ManagedProcess;
  onRestarted(cb: () => void): Unsubscribe;
  dispose(): Promise<void>;
};

export type ProcessRuntimePort = {
  send(message: unknown): void;
  onMessage(cb: (message: unknown) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
};

export type ServeWorkerProcessOptions = ServeOptions & {
  logger?: Logger;
  /**
   * Test seam for running the child-side helper without a real Node fork or
   * Electron utility process.
   */
  port?: ProcessRuntimePort;
  /**
   * Test seam for observing shutdown without terminating the test worker.
   */
  exit?: (code: number) => void;
};

export type ForwardRuntimeLogsOptions = {
  source?: string;
};

export async function spawnRuntime<Defs extends ContractDefinitions>(
  options: SpawnRuntimeOptions<Defs>
): Promise<RuntimeHandle<Defs>> {
  const spec = withDefaultGracefulShutdown(options.spec);
  const managed = await options.host.spawn(spec);
  options.onProcess?.(managed);

  try {
    await waitForReady(managed, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
  } catch (error) {
    await managed.dispose();
    throw error;
  }

  const restartedEmitter = new Emitter<void>();
  const reconnectListeners = new Set<() => void>();
  const unsubscribeReady = managed.onMessage((message) => {
    if (!isRuntimeSignal(message, 'ready')) return;
    for (const cb of reconnectListeners) cb();
    restartedEmitter.emit();
  });

  const transport = createRuntimeTransport(
    {
      send: (message) => managed.send(message),
      onMessage: (cb) => managed.onMessage(cb),
      onDisconnect: (cb) => managed.onExit(() => cb()),
    },
    {
      onReconnect(cb) {
        reconnectListeners.add(cb);
        return () => reconnectListeners.delete(cb);
      },
    }
  );

  const connection = connect(transport, { instrumentation: options.instrumentation });
  const runtimeClient = client(options.contract, connection);

  let disposePromise: Promise<void> | undefined;
  const handle: RuntimeHandle<Defs> = {
    client: runtimeClient,
    connection,
    process: managed,
    onRestarted(cb) {
      return restartedEmitter.subscribe(cb);
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposePromise = (async () => {
        unsubscribeReady();
        restartedEmitter.clear();
        reconnectListeners.clear();
        await managed.dispose();
      })();
      return disposePromise;
    },
  };

  options.scope?.use(handle);
  return handle;
}

export async function serveWorkerProcess(
  init: (scope: Scope) => Controller | Promise<Controller>,
  options: ServeWorkerProcessOptions = {}
): Promise<void> {
  const port = options.port ?? resolveParentPort();
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const scope = createScope({ label: 'worker-process', logger: options.logger });
  let exiting = false;

  const transport = createRuntimeTransport(port);

  const shutdown = async (code: number): Promise<void> => {
    if (exiting) return;
    exiting = true;
    await scope.dispose();
    exit(code);
  };

  scope.add(
    port.onMessage((message) => {
      if (isRuntimeSignal(message, 'shutdown')) void shutdown(0);
    })
  );
  scope.add(port.onDisconnect(() => void shutdown(0)));

  try {
    const controller = await init(scope);
    scope.add(() => controller.dispose?.());
    scope.add(serve(transport, controller, options));
    port.send(READY_SIGNAL);
  } catch (error) {
    await scope.dispose();
    const logger = options.logger ?? scope.log;
    logger.error('worker process failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    exit(1);
  }
}

export function workerValidatePolicy(env: NodeJS.ProcessEnv = process.env): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

export function forwardRuntimeLogs(
  process: ManagedProcess,
  logger: Logger,
  options: ForwardRuntimeLogsOptions = {}
): Unsubscribe {
  let stderrBuffer = '';
  const unsubscribeStdio = process.onStdio((stream, chunk) => {
    if (stream === 'stdout') {
      logger.debug('runtime stdout', { source: options.source, chunk });
      return;
    }

    stderrBuffer += chunk;
    let newline = stderrBuffer.indexOf('\n');
    while (newline !== -1) {
      const line = stderrBuffer.slice(0, newline);
      stderrBuffer = stderrBuffer.slice(newline + 1);
      forwardRuntimeLogLine(logger, line, options);
      newline = stderrBuffer.indexOf('\n');
    }
  });
  const unsubscribeExit = process.onExit(() => {
    if (stderrBuffer.trim()) forwardRuntimeLogLine(logger, stderrBuffer, options);
    stderrBuffer = '';
  });

  return () => {
    unsubscribeStdio();
    unsubscribeExit();
  };
}

function createRuntimeTransport(
  port: ProcessRuntimePort,
  options: Pick<WireTransport, 'onReconnect'> = {}
): WireTransport {
  return {
    post(message) {
      port.send(message);
    },
    onMessage(cb) {
      return port.onMessage((message) => {
        if (isWireMessage(message)) cb(message);
      });
    },
    onDisconnect(cb) {
      return port.onDisconnect(cb);
    },
    onReconnect: options.onReconnect,
  };
}

function withDefaultGracefulShutdown(spec: ProcessSpec): ProcessSpec {
  if (spec.gracefulShutdown) return spec;
  return {
    ...spec,
    gracefulShutdown: {
      message: RUNTIME_SHUTDOWN_SIGNAL,
      graceMs: DEFAULT_SHUTDOWN_GRACE_MS,
    },
  };
}

function forwardRuntimeLogLine(
  logger: Logger,
  line: string,
  options: ForwardRuntimeLogsOptions
): void {
  if (!line.trim()) return;

  const parsed = parseRuntimeLogLine(line);
  if (!parsed) {
    logger.warn('runtime stderr', { source: options.source, chunk: line });
    return;
  }

  const { level, message, fields } = parsed;
  logger[level](message, { source: options.source, ...fields });
}

function parseRuntimeLogLine(
  line: string
): { level: LogLevel; message: string; fields: LogFields } | null {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const level = parseRuntimeLogLevel(record.level);
    if (!level) return null;
    const message = typeof record.msg === 'string' ? record.msg : 'runtime log';
    const fields: LogFields = { ...record };
    delete fields.level;
    delete fields.msg;
    return { level, message, fields };
  } catch {
    return null;
  }
}

function parseRuntimeLogLevel(value: unknown): LogLevel | null {
  if (value === 'debug' || value === 20) return 'debug';
  if (value === 'info' || value === 30) return 'info';
  if (value === 'warn' || value === 40) return 'warn';
  if (value === 'error' || value === 50 || value === 60) return 'error';
  return null;
}

function waitForReady(managed: ManagedProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Runtime did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribeMessage = managed.onMessage((message) => {
      if (!isRuntimeSignal(message, 'ready')) return;
      cleanup();
      resolve();
    });
    const unsubscribeExit = managed.onExit((exit) => {
      if (exit.willRestart) return;
      cleanup();
      reject(new Error(`Runtime exited before ready (code ${exit.code})`));
    });

    function cleanup(): void {
      clearTimeout(timer);
      unsubscribeMessage();
      unsubscribeExit();
    }
  });
}

function isRuntimeSignal(
  message: unknown,
  event: RuntimeSignal['event']
): message is RuntimeSignal {
  if (typeof message !== 'object' || message === null) return false;
  const record = message as Record<string, unknown>;
  return record.kind === RUNTIME_SIGNAL_KIND && record.event === event;
}

function resolveParentPort(): ProcessRuntimePort {
  if (typeof process === 'undefined') {
    throw new Error('serveWorkerProcess requires an IPC channel to the parent process');
  }

  const currentProcess = process as NodeJS.Process & {
    parentPort?: {
      postMessage(message: unknown): void;
      on(event: 'message', cb: (event: { data: unknown }) => void): void;
      off(event: 'message', cb: (event: { data: unknown }) => void): void;
    };
  };

  if (currentProcess.parentPort) {
    const parentPort = currentProcess.parentPort;
    return {
      send(message) {
        parentPort.postMessage(message);
      },
      onMessage(cb) {
        const listener = (event: { data: unknown }): void => cb(event.data);
        parentPort.on('message', listener);
        return () => parentPort.off('message', listener);
      },
      onDisconnect() {
        return () => {};
      },
    };
  }

  if (typeof currentProcess.send !== 'function') {
    throw new Error('serveWorkerProcess requires an IPC channel to the parent process');
  }

  return {
    send(message) {
      currentProcess.send?.(message as Parameters<NonNullable<NodeJS.Process['send']>>[0]);
    },
    onMessage(cb) {
      currentProcess.on('message', cb);
      return () => currentProcess.off('message', cb);
    },
    onDisconnect(cb) {
      currentProcess.on('disconnect', cb);
      return () => currentProcess.off('disconnect', cb);
    },
  };
}

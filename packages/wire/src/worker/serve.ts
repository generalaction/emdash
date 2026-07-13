import { createScope } from '@emdash/shared/concurrency';
import { type Controller } from '../api/controller';
import { serve } from '../api/serve';
import type { ValidatePolicy } from '../api/with-validation';
import { compose } from '../util';
import { parentPortTransport, isWorkerSignal, WORKER_READY_SIGNAL } from './protocol';
import type { ServeWireWorkerContext, ServeWireWorkerOptions, WorkerParentPort } from './types';

export async function serveWireWorker(
  init: (context: ServeWireWorkerContext) => Controller | Promise<Controller>,
  options: ServeWireWorkerOptions = {}
): Promise<void> {
  const port = options.port ?? resolveParentPort();
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const scope = createScope({ label: 'worker-process', logger: options.logger });
  const logger = options.logger ?? scope.log;
  let exiting = false;

  const transport = parentPortTransport(port);

  const shutdown = async (code: number): Promise<void> => {
    if (exiting) return;
    exiting = true;
    await scope.dispose();
    exit(code);
  };

  scope.add(
    port.onMessage((message) => {
      if (isWorkerSignal(message, 'shutdown')) void shutdown(0);
    })
  );
  scope.add(port.onDisconnect(() => void shutdown(0)));

  try {
    const baseController = await init({ scope, logger });
    const controller = compose(baseController, options.middleware ?? []);
    scope.add(() => controller.dispose?.());
    scope.add(serve(transport, controller, options));
    port.send(WORKER_READY_SIGNAL);
  } catch (error) {
    await scope.dispose();
    logger.error('worker process failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    exit(1);
  }
}

export function workerValidatePolicy(env: NodeJS.ProcessEnv = process.env): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

function resolveParentPort(): WorkerParentPort {
  if (typeof process === 'undefined') {
    throw new Error('serveWireWorker requires an IPC channel to the parent process');
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
    throw new Error('serveWireWorker requires an IPC channel to the parent process');
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

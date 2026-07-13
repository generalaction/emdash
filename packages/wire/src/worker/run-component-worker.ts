import { createScope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { client } from '../api/client';
import { connect } from '../api/connect';
import type { ContractDefinitions } from '../api/define';
import { serve } from '../api/serve';
import {
  type ResolvedWireComponentRequirements,
  type WireComponentDefinition,
  type WireComponentRequirements,
} from '../component';
import {
  componentControllerSymbol,
  type InternalWireComponentInstance,
} from '../component/internal';
import {
  isWireComponentBootstrapResponse,
  parentPortChannelTransport,
  RUNTIME_CHANNEL,
  type WireComponentBootstrapResponse,
  type WireComponentBootstrapRequest,
} from './component-protocol';
import { WORKER_READY_SIGNAL, isWorkerSignal } from './protocol';
import type { WorkerParentPort } from './types';
import { workerValidatePolicy } from './validation';

const BOOTSTRAP_RETRY_MS = 50;

export type RunWireComponentWorkerOptions = {
  port?: WorkerParentPort;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  exit?: (code: number) => void;
};

export async function runWireComponentWorker<
  Id extends string,
  Defs extends ContractDefinitions,
  Requirements extends WireComponentRequirements,
  Config,
>(
  component: WireComponentDefinition<Id, Defs, Requirements, Config>,
  options: RunWireComponentWorkerOptions = {}
): Promise<void> {
  const port = options.port ?? resolveParentPort();
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const scope = createScope({ label: `component-worker:${component.id}`, logger: options.logger });

  const shutdown = async (code: number): Promise<void> => {
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
    const bootstrap = await requestBootstrap(component.id, port, scope.signal);
    const dependencies = buildDependencies(component, bootstrap.dependencies, port);
    const instance = component.create({
      scope,
      dependencies,
      config: bootstrap.config as Config,
      logger: options.logger,
      validate: workerValidatePolicy(options.env),
    }) as InternalWireComponentInstance<Defs>;
    const stopServing = serve(
      parentPortChannelTransport(port, RUNTIME_CHANNEL),
      instance[componentControllerSymbol]
    );
    scope.add(stopServing);
    port.send(WORKER_READY_SIGNAL);
  } catch (error) {
    await scope.dispose(error);
    options.logger?.error('component worker failed to start', {
      componentId: component.id,
      error: error instanceof Error ? error.message : String(error),
    });
    exit(1);
  }
}

function requestBootstrap(
  componentId: string,
  port: WorkerParentPort,
  signal: AbortSignal
): Promise<WireComponentBootstrapResponse> {
  const request: WireComponentBootstrapRequest = {
    kind: 'wire-component-bootstrap',
    event: 'request',
    componentId,
  };
  return new Promise((resolve, reject) => {
    let done = false;
    let retry: NodeJS.Timeout | undefined;
    const unsubscribe = port.onMessage((message) => {
      if (!isWireComponentBootstrapResponse(message) || message.componentId !== componentId) return;
      cleanup();
      resolve(message);
    });
    const unsubscribeDisconnect = port.onDisconnect(() => {
      cleanup();
      reject(new Error('Component worker bootstrap cancelled because the parent disconnected'));
    });
    const onAbort = (): void => {
      cleanup();
      reject(signal.reason ?? new Error('Component worker bootstrap cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    function cleanup(): void {
      if (done) return;
      done = true;
      if (retry) clearTimeout(retry);
      unsubscribe();
      unsubscribeDisconnect();
      signal.removeEventListener('abort', onAbort);
    }
    function send(): void {
      if (done) return;
      port.send(request);
      retry = setTimeout(send, BOOTSTRAP_RETRY_MS);
    }
    send();
  });
}

function buildDependencies<
  Id extends string,
  Defs extends ContractDefinitions,
  Requirements extends WireComponentRequirements,
  Config,
>(
  component: WireComponentDefinition<Id, Defs, Requirements, Config>,
  bootstrap: WireComponentBootstrapResponse['dependencies'],
  port: WorkerParentPort
): ResolvedWireComponentRequirements<Requirements> {
  const dependencies: Record<string, unknown> = {};
  for (const [key, requirement] of Object.entries(component.requirements)) {
    const supplied = bootstrap[key];
    if (!supplied) throw new Error(`Missing bootstrap dependency '${key}'`);
    if (supplied.kind !== 'contract') throw new Error(`Dependency '${key}' is not a contract`);
    dependencies[key] = client(
      requirement.contract,
      connect(parentPortChannelTransport(port, supplied.channel))
    );
  }
  return dependencies as ResolvedWireComponentRequirements<Requirements>;
}

function resolveParentPort(): WorkerParentPort {
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
    throw new Error('runWireComponentWorker requires an IPC channel to the parent process');
  }

  return {
    send(message) {
      currentProcess.send?.(message);
    },
    onMessage(cb) {
      const listener = (message: unknown): void => cb(message);
      currentProcess.on('message', listener);
      return () => currentProcess.off('message', listener);
    },
    onDisconnect(cb) {
      const listener = (): void => cb();
      currentProcess.on('disconnect', listener);
      return () => currentProcess.off('disconnect', listener);
    },
  };
}

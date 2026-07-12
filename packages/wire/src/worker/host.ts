import type { ContractDefinitions } from '../api/define';
import { systemClock } from '../scheduling';
import type {
  WireWorker,
  WireWorkerDefinition,
  WireWorkerHost,
  WireWorkerHostOptions,
} from './types';
import { WorkerSlot } from './worker-slot';

export function createWireWorkerHost(options: WireWorkerHostOptions): WireWorkerHost {
  return new WireWorkerHostImpl(options);
}

class WireWorkerHostImpl implements WireWorkerHost {
  private readonly workers = new Map<string, WireWorker<ContractDefinitions>>();

  constructor(private readonly options: WireWorkerHostOptions) {}

  get scope() {
    return this.options.scope;
  }

  define<Defs extends ContractDefinitions>(
    definition: WireWorkerDefinition<Defs>
  ): WireWorker<Defs> {
    if (this.workers.has(definition.name)) {
      throw new Error(`Wire worker '${definition.name}' is already defined`);
    }

    const scope = this.options.scope.child(`worker:${definition.name}`);
    const logger = (this.options.logger ?? scope.log).child({ worker: definition.name });
    const slot = new WorkerSlot({
      definition,
      scope,
      processSpawner: this.options.processSpawner,
      clock: this.options.clock ?? systemClock,
      logger,
      defaultSupervision: this.options.defaults?.supervision,
      defaultReadyTimeoutMs: this.options.defaults?.readyTimeoutMs,
      defaultShutdownGraceMs: this.options.defaults?.shutdownGraceMs,
    });

    this.workers.set(definition.name, slot as WireWorker<ContractDefinitions>);
    scope.add(() => {
      this.workers.delete(definition.name);
    });

    return slot;
  }

  get(name: string): WireWorker<ContractDefinitions> | undefined {
    return this.workers.get(name);
  }

  dispose(): Promise<void> {
    return this.options.scope.dispose(new Error('Wire worker host disposed'));
  }
}

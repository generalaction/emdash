import { Emitter, type PendingLease, type Unsubscribe } from '@emdash/shared';
import type { ThinLiveLogRef } from '../../api/client';
import type { LiveLogEndpointDef, LiveLogKey } from '../../api/define';
import type { WireInstrumentation } from '../../observability';
import { createManagedSource } from '../../util/managed-source';
import { LiveLog, LiveLogClient, type LiveLogOptions } from '../log';
import { stableStringify } from '../mutations';
import type { LiveLogSnapshotData, LiveSnapshot, LiveSource, LiveUpdate } from '../protocol';
import { managedLiveSource } from './source';

export type ReplicaLogOptions = LiveLogOptions & {
  instrumentation?: WireInstrumentation;
};

export class ReplicaLog implements LiveSource {
  readonly ready: Promise<void>;

  private readonly local: LiveLog;
  private readonly client: LiveLogClient;
  private readonly appendEmitter = new Emitter<string>();
  private readonly detachPromise: Promise<Unsubscribe>;
  private disposed = false;

  constructor(
    private readonly handle: ReturnType<ThinLiveLogRef['handle']>,
    private readonly options: ReplicaLogOptions = {}
  ) {
    this.local = new LiveLog(options);
    this.client = new LiveLogClient({
      refetchSnapshot: () => handle.snapshot(),
      onReset: (data) => this.reset(data),
      onAppend: (chunk) => this.append(chunk),
      instrumentation: options.instrumentation,
      topic: handle.topic,
    });
    this.ready = handle.snapshot().then((snapshot) => this.client.seed(snapshot));
    this.detachPromise = handle.attach((update) => this.client.applyUpdate(update), {
      onReattach: () => void this.client.refresh(),
    });
  }

  text(): string {
    return this.local.snapshot().data.text;
  }

  onAppend(cb: (chunk: string) => void): Unsubscribe {
    return this.appendEmitter.subscribe(cb);
  }

  async snapshot(): Promise<LiveSnapshot<LiveLogSnapshotData>> {
    await this.ready;
    return this.local.snapshot();
  }

  subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
    return this.local.subscribe(cb);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.appendEmitter.clear();
    (await this.detachPromise)();
  }

  private reset(data: LiveLogSnapshotData): void {
    this.local.reseed();
    if (data.text.length > 0) this.local.append(data.text);
  }

  private append(chunk: string): void {
    this.local.append(chunk);
    this.appendEmitter.emit(chunk);
  }
}

export type LiveLogReplicaOptions = ReplicaLogOptions & {
  retentionMs?: number;
};

export type LiveLogReplica<Def extends LiveLogEndpointDef = LiveLogEndpointDef> = {
  readonly kind: 'liveLogReplica';
  readonly def: Def;
  acquire(key: LiveLogKey<Def>): PendingLease<ReplicaLog>;
  peek(key: LiveLogKey<Def>): ReplicaLog | undefined;
  resolve(key: LiveLogKey<Def>): LiveSource;
  dispose(): Promise<void>;
};

export function createLiveLogReplica<Def extends LiveLogEndpointDef>(
  def: Def,
  log: ThinLiveLogRef<Def>,
  options: LiveLogReplicaOptions = {}
): LiveLogReplica<Def> {
  const source = createManagedSource<LiveLogKey<Def>, ReplicaLog>({
    key: stableStringify,
    graceMs: options.retentionMs,
    async create(key, scope) {
      const replica = new ReplicaLog(log.handle(key), options);
      scope.add(() => replica.dispose());
      await replica.ready;
      return replica;
    },
  });

  return {
    kind: 'liveLogReplica',
    def,
    acquire(key) {
      return source.acquire(key);
    },
    peek(key) {
      return source.peek(key);
    },
    resolve(key) {
      return managedLiveSource(source, key, (replica) => replica);
    },
    dispose() {
      return source.dispose();
    },
  };
}

export function isLiveLogReplica(value: unknown): value is LiveLogReplica {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'liveLogReplica'
  );
}

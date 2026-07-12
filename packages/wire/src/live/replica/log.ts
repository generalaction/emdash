import { Emitter, type PendingLease, type Unsubscribe } from '@emdash/shared';
import type { LiveLogClientHandle } from '../../api/client';
import type { LiveLogEndpointDef, LiveLogKey } from '../../api/define';
import type { WireInstrumentation } from '../../observability';
import { createResourceCache } from '../../util/resource-cache';
import { LiveLog, LiveLogClient, type LiveLogOptions } from '../log';
import { stableStringify } from '../mutations';
import type { LiveLogSnapshotData, LiveSnapshot, LiveSource, LiveUpdate } from '../protocol';
import { resourceCachedLiveSource } from './source';

export interface LogSink {
  reset(data: LiveLogSnapshotData): void;
  append(chunk: string): void;
}

export interface LogStore extends LogSink {
  text(): string;
}

export type ReplicaLogOptions = LiveLogOptions & {
  instrumentation?: WireInstrumentation;
  store?: LogSink;
};

export class ReplicaLog implements LiveSource {
  readonly ready: Promise<void>;

  private local: LiveLog | undefined;
  private readonly client: LiveLogClient;
  private readonly appendEmitter = new Emitter<string>();
  private readonly detachPromise: Promise<Unsubscribe>;
  private writtenOffset = 0;
  private disposed = false;

  constructor(
    private readonly handle: ReturnType<LiveLogClientHandle['handle']>,
    private readonly options: ReplicaLogOptions = {}
  ) {
    if (!options.store) this.local = new LiveLog(options);
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
    const readable = asReadableLogStore(this.options.store);
    if (readable) return readable.text();
    if (this.local) return this.local.snapshot().data.text;
    throw new Error('ReplicaLog is backed by a write-only LogSink');
  }

  onAppend(cb: (chunk: string) => void): Unsubscribe {
    return this.appendEmitter.subscribe(cb);
  }

  async snapshot(): Promise<LiveSnapshot<LiveLogSnapshotData>> {
    await this.ready;
    return this.localSource().snapshot();
  }

  subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
    return this.localSource().subscribe(cb);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.appendEmitter.clear();
    (await this.detachPromise)();
  }

  private reset(data: LiveLogSnapshotData): void {
    this.options.store?.reset(data);
    this.local?.reseed(data);
    this.writtenOffset = data.baseOffset + byteLength(data.text);
  }

  private append(chunk: string): void {
    this.options.store?.append(chunk);
    this.local?.append(chunk);
    this.writtenOffset += byteLength(chunk);
    this.appendEmitter.emit(chunk);
  }

  private localSource(): LiveLog {
    if (!this.local) {
      const readable = asReadableLogStore(this.options.store);
      const text = readable?.text() ?? '';
      const bytes = byteLength(text);
      const baseOffset = this.writtenOffset >= bytes ? this.writtenOffset - bytes : 0;
      this.local = new LiveLog(this.options);
      this.local.reseed({
        baseOffset,
        text,
        truncated: true,
      });
    }
    return this.local;
  }
}

export type LiveLogReplicaOptions = Omit<ReplicaLogOptions, 'store'> & {
  retentionMs?: number;
  store?: () => LogSink;
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
  log: LiveLogClientHandle<Def>,
  options: LiveLogReplicaOptions = {}
): LiveLogReplica<Def> {
  const source = createResourceCache<LiveLogKey<Def>, ReplicaLog>({
    key: stableStringify,
    idleTtlMs: options.retentionMs,
    async create(key, scope) {
      const { store, ...replicaOptions } = options;
      const replica = new ReplicaLog(log.handle(key), { ...replicaOptions, store: store?.() });
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
      return resourceCachedLiveSource(source, key, (replica) => replica);
    },
    dispose() {
      return source.dispose();
    },
  };
}

function asReadableLogStore(store: LogSink | undefined): LogStore | undefined {
  if (!store) return undefined;
  const candidate = store as Partial<LogStore>;
  return typeof candidate.text === 'function' ? (store as LogStore) : undefined;
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

export function isLiveLogReplica(value: unknown): value is LiveLogReplica {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'liveLogReplica'
  );
}

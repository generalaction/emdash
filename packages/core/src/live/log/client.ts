import type { LiveLogDelta, LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '../protocol';

export type LiveLogClientDeps = {
  refetchSnapshot: () => Promise<LiveSnapshot<LiveLogSnapshotData>>;
  onReset: (data: LiveLogSnapshotData) => void;
  onAppend: (chunk: string) => void;
};

export class LiveLogClient {
  private generation = -1;
  private sequence = -1;
  private value: LiveLogSnapshotData | undefined;
  private resyncing = false;

  constructor(private readonly deps: LiveLogClientDeps) {}

  isReady(): boolean {
    return this.value !== undefined;
  }

  getSnapshot(): LiveLogSnapshotData | undefined {
    return this.value;
  }

  seed(snapshot: LiveSnapshot<LiveLogSnapshotData>): void {
    this.value = snapshot.data;
    this.generation = snapshot.generation;
    this.sequence = snapshot.sequence;
    this.deps.onReset(this.value);
  }

  applyUpdate(update: LiveUpdate): void {
    if (!this.value) {
      console.log('[LiveLogClient] applyUpdate called before seed, resyncing');
      void this.resync();
      return;
    }

    if (update.generation !== this.generation) {
      console.log('[LiveLogClient] generation mismatch - resyncing', {
        local: this.generation,
        incoming: update.generation,
      });
      void this.resync();
      return;
    }

    if (update.baseSequence !== this.sequence) {
      console.log('[LiveLogClient] sequence gap - resyncing', {
        expected: this.sequence,
        got: update.baseSequence,
      });
      void this.resync();
      return;
    }

    if (!isLiveLogDelta(update.delta)) {
      console.log('[LiveLogClient] invalid delta - resyncing');
      void this.resync();
      return;
    }

    this.sequence = update.sequence;
    this.value = {
      ...this.value,
      text: this.value.text + update.delta.chunk,
    };
    this.deps.onAppend(update.delta.chunk);
  }

  private async resync(): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      this.seed(await this.deps.refetchSnapshot());
    } finally {
      this.resyncing = false;
    }
  }
}

function isLiveLogDelta(value: unknown): value is LiveLogDelta {
  return (
    typeof value === 'object' &&
    value !== null &&
    'chunk' in value &&
    typeof (value as { chunk: unknown }).chunk === 'string'
  );
}

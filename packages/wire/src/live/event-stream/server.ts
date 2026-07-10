import { Emitter, type Unsubscribe } from '@emdash/shared';
import type { EventStreamEndpointDef, EventStreamEvent, EventStreamKey } from '../../api/define';
import { stableStringify } from '../mutations';
import type {
  EventStreamDelta,
  EventStreamSnapshotData,
  LiveSnapshot,
  LiveUpdate,
} from '../protocol';

export type EventStreamSourceOptions = {
  generation?: number;
  onEmpty?: () => void;
};

/**
 * A no-retention event stream. Events emitted while no subscriber is attached are dropped.
 */
export class EventStreamSource<Event = unknown> {
  private readonly emitter = new Emitter<LiveUpdate>();
  private readonly onEmpty: (() => void) | undefined;
  private readonly generation: number;
  private sequence = 0;

  constructor(options: EventStreamSourceOptions = {}) {
    this.generation = options.generation ?? Date.now();
    this.onEmpty = options.onEmpty;
  }

  get subscriberCount(): number {
    return this.emitter.size;
  }

  emit(event: Event): void {
    if (this.emitter.size === 0) return;

    const baseSequence = this.sequence;
    this.sequence += 1;
    const delta: EventStreamDelta = { event };
    this.emitter.emit({
      generation: this.generation,
      baseSequence,
      sequence: this.sequence,
      timestamp: Date.now(),
      delta,
    });
  }

  snapshot(): LiveSnapshot<EventStreamSnapshotData> {
    return {
      generation: this.generation,
      sequence: this.sequence,
      timestamp: Date.now(),
      data: {},
    };
  }

  subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
    const unsubscribe = this.emitter.subscribe(cb);
    return () => {
      unsubscribe();
      if (this.emitter.size === 0) this.onEmpty?.();
    };
  }
}

export type EventStreamHost<Def extends EventStreamEndpointDef = EventStreamEndpointDef> = {
  readonly kind: 'eventStreamHost';
  readonly def: Def;
  emit(key: EventStreamKey<Def>, event: EventStreamEvent<Def>): void;
  resolve(key: EventStreamKey<Def>): EventStreamSource<EventStreamEvent<Def>>;
  dispose(): void;
};

export function createEventStreamHost<Def extends EventStreamEndpointDef>(
  def: Def
): EventStreamHost<Def> {
  const sources = new Map<string, EventStreamSource<EventStreamEvent<Def>>>();

  function keyOf(key: EventStreamKey<Def>): string {
    return stableStringify(key);
  }

  function removeIfEmpty(keyId: string, source: EventStreamSource<EventStreamEvent<Def>>): void {
    if (source.subscriberCount === 0 && sources.get(keyId) === source) {
      sources.delete(keyId);
    }
  }

  return {
    kind: 'eventStreamHost',
    def,
    emit(key, event) {
      sources.get(keyOf(key))?.emit(event);
    },
    resolve(key) {
      const keyId = keyOf(key);
      let source = sources.get(keyId);
      if (!source) {
        const created = new EventStreamSource<EventStreamEvent<Def>>({
          onEmpty: () => removeIfEmpty(keyId, created),
        });
        source = created;
        sources.set(keyId, created);
      }
      return source;
    },
    dispose() {
      sources.clear();
    },
  };
}

export function isEventStreamHost(value: unknown): value is EventStreamHost {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'eventStreamHost'
  );
}

import { createEmitter, type Unsubscribe } from '@emdash/shared';
import type {
  LiveLogSnapshotData,
  LiveSnapshot,
  LiveSubscribeOptions,
  LiveUpdate,
  PressureSignal,
  SnapshotOptions,
} from '../../api/channel';
import type { LiveLogDelta } from '../protocol';

/**
 * Shared retention cap for log sources and their client-side stores: keeping
 * one constant means source and client cannot drift apart.
 */
export const LIVE_LOG_DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type RetainedChunk = {
  text: string;
  bytes: number;
};

export type LiveLogSourceOptions = {
  maxBufferBytes?: number;
  generation?: number;
  onPressureChange?: (paused: boolean) => void;
};

/**
 * Transport-agnostic append-only log source.
 *
 * The update envelope matches LiveStateSource, but the delta is log-specific:
 * `{ chunk: string }`. Snapshots return the retained tail plus the byte offset
 * of the first retained byte so clients can reset cheaply after gaps.
 */
type LogSubscription = {
  pressure?: PressureSignal;
  unsubscribeEmitter: Unsubscribe;
  unsubscribePressure?: () => void;
};

type PressureWatcher = (paused: boolean) => void;

export class LiveLogSource {
  private readonly emitter = createEmitter<LiveUpdate>();
  private readonly maxBufferBytes: number;
  private readonly onPressureChange: ((paused: boolean) => void) | undefined;
  private readonly subscriptions = new Set<LogSubscription>();
  private readonly pressureWatchers = new Set<PressureWatcher>();
  private paused = false;
  private generation: number;
  private sequence = 0;
  private baseOffset = 0;
  private bufferedBytes = 0;
  private truncated = false;
  private chunks: RetainedChunk[] = [];

  constructor(options: LiveLogSourceOptions = {}) {
    this.maxBufferBytes = Math.max(0, options.maxBufferBytes ?? LIVE_LOG_DEFAULT_MAX_BUFFER_BYTES);
    this.onPressureChange = options.onPressureChange;
    this.generation = options.generation ?? Date.now();
  }

  append(chunk: string): void {
    if (chunk.length === 0) return;

    const retained = { text: chunk, bytes: byteLength(chunk) };
    this.chunks.push(retained);
    this.bufferedBytes += retained.bytes;
    this.evictOldChunks();

    const baseSequence = this.sequence;
    this.sequence += 1;
    const delta: LiveLogDelta = { chunk };
    this.emitter.emit({
      generation: this.generation,
      baseSequence,
      sequence: this.sequence,
      timestamp: Date.now(),
      delta,
    });
  }

  snapshot(options?: SnapshotOptions): LiveSnapshot<LiveLogSnapshotData> {
    const fullText = this.chunks.map((chunk) => chunk.text).join('');
    const since = options?.since;
    if (since && since.generation === this.generation) {
      const endOffset = this.baseOffset + this.bufferedBytes;
      if (this.baseOffset <= since.offset && since.offset <= endOffset) {
        const text = sliceRetainedChunks(this.chunks, since.offset - this.baseOffset);
        if (text !== undefined) {
          return {
            generation: this.generation,
            sequence: this.sequence,
            timestamp: Date.now(),
            data: {
              baseOffset: since.offset,
              text,
              truncated: this.truncated,
            },
          };
        }
      }
    }

    return {
      generation: this.generation,
      sequence: this.sequence,
      timestamp: Date.now(),
      data: {
        baseOffset: this.baseOffset,
        text: fullText,
        truncated: this.truncated,
      },
    };
  }

  reseed(data?: LiveLogSnapshotData): void {
    this.generation = Math.max(this.generation + 1, Date.now());
    this.sequence = 0;
    this.baseOffset = data?.baseOffset ?? 0;
    this.truncated = data?.truncated ?? false;
    this.chunks = data?.text ? [{ text: data.text, bytes: byteLength(data.text) }] : [];
    this.bufferedBytes = this.chunks.reduce((total, chunk) => total + chunk.bytes, 0);
    this.evictOldChunks();
  }

  subscribe(cb: (update: LiveUpdate) => void, options?: LiveSubscribeOptions): Unsubscribe {
    const pressure = options?.pressure;
    const subscription: LogSubscription = {
      pressure,
      unsubscribeEmitter: this.emitter.subscribe(cb),
    };
    this.subscriptions.add(subscription);
    subscription.unsubscribePressure = pressure?.onChange(() => this.recomputePressure());
    this.recomputePressure();

    return () => {
      if (!this.subscriptions.delete(subscription)) return;
      subscription.unsubscribePressure?.();
      subscription.unsubscribeEmitter();
      this.recomputePressure();
    };
  }

  watchPressure(cb: PressureWatcher): Unsubscribe {
    this.pressureWatchers.add(cb);
    if (this.paused) cb(true);
    return () => {
      this.pressureWatchers.delete(cb);
    };
  }

  private recomputePressure(): void {
    let next = false;
    for (const subscription of this.subscriptions) {
      if (subscription.pressure?.paused === true) {
        next = true;
        break;
      }
    }
    if (next === this.paused) return;
    this.paused = next;
    this.onPressureChange?.(next);
    for (const watcher of this.pressureWatchers) watcher(next);
  }

  private evictOldChunks(): void {
    while (this.chunks.length > 1 && this.bufferedBytes > this.maxBufferBytes) {
      const [removed] = this.chunks.splice(0, 1);
      if (!removed) return;
      this.baseOffset += removed.bytes;
      this.bufferedBytes -= removed.bytes;
      this.truncated = true;
    }
  }
}

function sliceRetainedChunks(
  chunks: RetainedChunk[],
  relativeByteOffset: number
): string | undefined {
  let remaining = relativeByteOffset;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk === undefined) return undefined;
    if (remaining === 0) {
      return chunks
        .slice(i)
        .map((chunk) => chunk.text)
        .join('');
    }
    if (remaining < chunk.bytes) {
      const suffix = sliceUtf8FromByteOffset(chunk.text, remaining);
      if (suffix === undefined) return undefined;
      return (
        suffix +
        chunks
          .slice(i + 1)
          .map((chunk) => chunk.text)
          .join('')
      );
    }
    remaining -= chunk.bytes;
  }
  return remaining === 0 ? '' : undefined;
}

function sliceUtf8FromByteOffset(text: string, relativeByteOffset: number): string | undefined {
  if (relativeByteOffset === 0) return text;

  const bytes = encoder.encode(text);
  const totalBytes = bytes.byteLength;
  if (relativeByteOffset === totalBytes) return '';
  if (relativeByteOffset < 0 || relativeByteOffset > totalBytes) return undefined;

  const byte = bytes[relativeByteOffset];
  if (byte === undefined || (byte & 0xc0) === 0x80) return undefined;
  return decoder.decode(bytes.slice(relativeByteOffset));
}

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

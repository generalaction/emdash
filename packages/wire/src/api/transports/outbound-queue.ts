import type { WireMessage } from '../protocol';

export type DrainableWritable = {
  write(chunk: string | Uint8Array): unknown;
  once?(event: 'drain', cb: () => void): unknown;
};

export type OutboundQueueOptions = {
  /** Bound on all bytes held while the writer applies backpressure; past it the transport fails. */
  maxQueuedBytes?: number;
  /** Bound on queued bytes for one live topic; past it the topic drops its backlog to a topic-gap. */
  maxTopicBytes?: number;
  /** Age of a topic's oldest queued update past which the topic drops its backlog to a topic-gap. */
  maxTopicAgeMs?: number;
  /** Clock for frame ages; tests inject their own. */
  now?: () => number;
};

export const DEFAULT_MAX_QUEUED_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_TOPIC_BYTES = 16 * 1024 * 1024; // A memory cap well above a burst; the age limit does the work.
const DEFAULT_MAX_TOPIC_AGE_MS = 3000; // Older output is no longer live and a resync is cheaper than delivering it late.
const QUANTUM_BYTES = 64 * 1024;
// Results this large are snapshots or bulk reads: they share bandwidth instead of jumping ahead.
const LARGE_RESULT_BYTES = 64 * 1024;
const LARGE_RESULTS = 'large-results';
const UPDATE_LANE_PREFIX = 'update:';

type QueuedFrame = {
  bytes: Uint8Array;
  /** Enqueue time from the queue's clock. */
  at: number;
};

type Lane = {
  frames: QueuedFrame[];
  deficit: number;
  queuedBytes: number;
  /** The queued topic-gap frame, if any; it is always the first frame in `frames`. */
  gapFrame?: QueuedFrame;
};

/**
 * Honours writer backpressure without dropping anything. While blocked, small control frames
 * keep FIFO order ahead of everything else; live updates (per topic), blob streams (per channel)
 * and large results each get a lane, and lanes share the writer by deficit round robin, so no
 * busy topic, snapshot or upload can starve another. A live topic whose backlog gets too old or
 * too large drops its queued updates and enqueues a topic-gap so followers resync before newer
 * updates; transport overflow is still the last-resort bound for non-droppable traffic.
 */
export function createOutboundQueue(
  output: DrainableWritable,
  encode: (message: WireMessage) => Uint8Array,
  onOverflow: () => void,
  options: OutboundQueueOptions = {}
) {
  const maxQueuedBytes = options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
  const maxTopicBytes = options.maxTopicBytes ?? DEFAULT_MAX_TOPIC_BYTES;
  const maxTopicAgeMs = options.maxTopicAgeMs ?? DEFAULT_MAX_TOPIC_AGE_MS;
  const now = options.now ?? (() => performance.now());
  const control: Uint8Array[] = [];
  const lanes = new Map<string, Lane>();
  const rotation: string[] = [];
  let queuedBytes = 0;
  let skippedBytes = 0;
  let skippedFrames = 0;
  let blocked = false;

  const isEmpty = (): boolean => control.length === 0 && lanes.size === 0;

  function write(frame: Uint8Array): void {
    if (output.write(frame) !== false || !output.once) return;
    blocked = true;
    output.once('drain', flush);
  }

  function flush(): void {
    blocked = false;
    while (!blocked) {
      const frame = nextFrame();
      if (!frame) return;
      queuedBytes -= frame.byteLength;
      write(frame);
    }
  }

  function nextFrame(): Uint8Array | undefined {
    const controlFrame = control.shift();
    if (controlFrame) return controlFrame;
    for (;;) {
      const key = rotation[0];
      if (key === undefined) return undefined;
      const lane = lanes.get(key)!;
      dropIfStale(key, lane);
      const head = lane.frames[0]!;
      if (lane.deficit >= head.bytes.byteLength) return takeHead(key, lane);
      lane.deficit += QUANTUM_BYTES;
      rotation.push(rotation.shift()!);
    }
  }

  function takeHead(key: string, lane: Lane): Uint8Array {
    const frame = lane.frames.shift()!;
    if (frame === lane.gapFrame) lane.gapFrame = undefined;
    lane.deficit -= frame.bytes.byteLength;
    lane.queuedBytes -= frame.bytes.byteLength;
    if (lane.frames.length === 0) {
      lanes.delete(key);
      rotation.splice(rotation.indexOf(key), 1);
    }
    return frame.bytes;
  }

  function isStale(lane: Lane): boolean {
    const oldestUpdate = lane.frames[lane.gapFrame ? 1 : 0];
    return oldestUpdate !== undefined && now() - oldestUpdate.at > maxTopicAgeMs;
  }

  function dropIfStale(key: string, lane: Lane): void {
    if (isUpdateLaneKey(key) && isStale(lane)) replaceUpdateLaneWithGap(key, lane);
  }

  function dropUpdateFrames(lane: Lane): void {
    const gapFrame = lane.gapFrame;
    for (const frame of lane.frames) {
      if (frame === gapFrame) continue;
      queuedBytes -= frame.bytes.byteLength;
      skippedBytes += frame.bytes.byteLength;
      skippedFrames += 1;
    }
    lane.frames = gapFrame ? [gapFrame] : [];
    lane.queuedBytes = gapFrame?.bytes.byteLength ?? 0;
  }

  function replaceUpdateLaneWithGap(key: string, lane: Lane): void {
    dropUpdateFrames(lane);
    if (lane.gapFrame) return;

    const gapFrame = {
      bytes: encode({ kind: 'topic-gap', topic: updateTopicFromKey(key) }),
      at: now(),
    };
    lane.frames.push(gapFrame);
    lane.gapFrame = gapFrame;
    lane.queuedBytes += gapFrame.bytes.byteLength;
    queuedBytes += gapFrame.bytes.byteLength;
  }

  function compactUpdateLanes(): void {
    for (const [key, lane] of lanes) {
      if (isUpdateLaneKey(key)) replaceUpdateLaneWithGap(key, lane);
    }
  }

  function laneAt(key: string): Lane {
    let lane = lanes.get(key);
    if (!lane) {
      lane = { frames: [], deficit: 0, queuedBytes: 0 };
      lanes.set(key, lane);
      rotation.push(key);
    }
    return lane;
  }

  function enqueueIntoLane(key: string, frame: Uint8Array): void {
    const lane = laneAt(key);
    // Before pushing, so the new update survives behind the gap.
    dropIfStale(key, lane);
    lane.frames.push({ bytes: frame, at: now() });
    lane.queuedBytes += frame.byteLength;
    if (isUpdateLaneKey(key) && lane.queuedBytes > maxTopicBytes) {
      replaceUpdateLaneWithGap(key, lane);
    }
  }

  function enqueue(key: string | undefined, frame: Uint8Array): void {
    queuedBytes += frame.byteLength;
    if (key === undefined) control.push(frame);
    else enqueueIntoLane(key, frame);

    if (queuedBytes > maxQueuedBytes) {
      compactUpdateLanes();
      if (queuedBytes > maxQueuedBytes) onOverflow();
    }
  }

  return {
    post(message: WireMessage): void {
      const frame = encode(message);
      if (!blocked && isEmpty()) write(frame);
      else enqueue(laneFor(message, frame), frame);
    },
    get queuedBytes(): number {
      return queuedBytes;
    },
    get skippedBytes(): number {
      return skippedBytes;
    },
    get skippedFrames(): number {
      return skippedFrames;
    },
    clear(): void {
      control.length = 0;
      lanes.clear();
      rotation.length = 0;
      queuedBytes = 0;
      skippedBytes = 0;
      skippedFrames = 0;
    },
  };
}

function isUpdateLaneKey(key: string): boolean {
  return key.startsWith(UPDATE_LANE_PREFIX);
}

function updateTopicFromKey(key: string): string {
  return key.slice(UPDATE_LANE_PREFIX.length);
}

/** Bulk payloads get a lane; a blob's end and error follow its chunks in the same lane. */
function laneFor(message: WireMessage, frame: Uint8Array): string | undefined {
  switch (message.kind) {
    case 'update':
      return message.flow ? `credit:${message.topic}` : `update:${message.topic}`;
    case 'blob-chunk':
    case 'blob-end':
    case 'blob-error':
      return `blob:${message.channel}`;
    case 'result':
      return frame.byteLength > LARGE_RESULT_BYTES ? LARGE_RESULTS : undefined;
    default:
      return undefined;
  }
}

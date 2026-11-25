import { describe, expect, it } from 'vitest';
import type { WireMessage } from '../protocol';
import { createOutboundQueue } from './outbound-queue';

class BlockingWritable {
  readonly written: WireMessage[] = [];
  capacity = Infinity;
  private drain: (() => void) | undefined;

  write(chunk: Uint8Array): boolean {
    this.written.push(JSON.parse(new TextDecoder().decode(chunk)) as WireMessage);
    return this.written.length < this.capacity;
  }

  once(_event: 'drain', cb: () => void): void {
    this.drain = cb;
  }

  release(capacity = Infinity): void {
    this.capacity = this.written.length + capacity;
    const drain = this.drain;
    this.drain = undefined;
    drain?.();
  }
}

const encode = (message: WireMessage): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(message));

const update = (topic: string, sequence: number, chunk = 'x'): WireMessage => ({
  kind: 'update',
  topic,
  update: { generation: 1, baseSequence: sequence - 1, sequence, timestamp: 0, delta: { chunk } },
});

const blobChunk = (seq: number, size: number): WireMessage =>
  ({
    kind: 'blob-chunk',
    channel: 'upload',
    seq,
    data: 'z'.repeat(size),
  }) as unknown as WireMessage;

const label = (message: WireMessage): string => {
  if (message.kind === 'update') return `${message.topic}:${message.update.sequence}`;
  if (message.kind === 'blob-chunk') return `blob:${message.seq}`;
  return message.kind;
};

const forTopic = (messages: WireMessage[], topic: string): WireMessage[] =>
  messages.filter(
    (message) =>
      (message.kind === 'update' || message.kind === 'topic-gap') && message.topic === topic
  );

const totalBytes = (messages: WireMessage[]): number =>
  messages.reduce((total, message) => total + encode(message).byteLength, 0);

// The default clock is frozen so age limits never trip unless a test moves time.
function blockedQueue(
  maxQueuedBytes?: number,
  maxTopicBytes?: number,
  now: () => number = () => 0
) {
  const output = new BlockingWritable();
  output.capacity = 1;
  const overflows: number[] = [];
  const queue = createOutboundQueue(output, encode, () => overflows.push(queue.queuedBytes), {
    maxQueuedBytes,
    maxTopicBytes,
    now,
  });
  return { output, queue, overflows };
}

describe('createOutboundQueue', () => {
  it('stops writing when the writer pushes back and resumes on drain', () => {
    const { output, queue } = blockedQueue();
    queue.post(update('a', 1));
    queue.post(update('a', 2));
    queue.post(update('a', 3));
    expect(output.written.map(label)).toEqual(['a:1']);

    output.release();
    expect(output.written.map(label)).toEqual(['a:1', 'a:2', 'a:3']);
    expect(queue.queuedBytes).toBe(0);
  });

  it('sends small control frames first and shares bandwidth between topics by bytes', () => {
    const { output, queue } = blockedQueue();
    const chunk = 'x'.repeat(40 * 1024);
    for (let sequence = 1; sequence <= 4; sequence++) queue.post(update('bulk', sequence, chunk));
    queue.post(update('typed', 1));
    queue.post({ kind: 'result', id: 'health', ok: true, value: null });
    output.release();

    expect(output.written.map(label)).toEqual([
      'bulk:1',
      'result',
      'bulk:2',
      'typed:1',
      'bulk:3',
      'bulk:4',
    ]);
  });

  it('lets updates through while a large result is still queued', () => {
    const { output, queue } = blockedQueue();
    queue.post(update('first', 1));
    queue.post({ kind: 'result', id: 'snapshot', ok: true, value: 'y'.repeat(256 * 1024) });
    queue.post(update('typed', 1));
    output.release();

    expect(output.written.map(label)).toEqual(['first:1', 'typed:1', 'result']);
  });

  it('shares bandwidth with blob streams and keeps a blob end after its chunks', () => {
    const { output, queue } = blockedQueue();
    queue.post(update('first', 1));
    for (let seq = 0; seq < 3; seq++) queue.post(blobChunk(seq, 60 * 1024));
    queue.post({ kind: 'blob-end', channel: 'upload' });
    queue.post(update('typed', 1));
    output.release();

    expect(output.written.map(label)).toEqual([
      'first:1',
      'blob:0',
      'typed:1',
      'blob:1',
      'blob:2',
      'blob-end',
    ]);
  });

  it('overloads a busy update topic into exactly one topic-gap then its later updates in order', () => {
    const maxTopicBytes = 2 * 1024 * 1024;
    const { output, queue, overflows } = blockedQueue(undefined, maxTopicBytes);
    const chunk = 'y'.repeat(128 * 1024);
    let postedBytes = 0;
    let maxQueued = 0;

    for (let sequence = 1; sequence <= 400; sequence++) {
      const message = update('hot', sequence, chunk);
      postedBytes += encode(message).byteLength;
      queue.post(message);
      maxQueued = Math.max(maxQueued, queue.queuedBytes);
    }

    expect(overflows).toEqual([]);
    expect(maxQueued).toBeLessThanOrEqual(maxTopicBytes);

    output.release();

    const hotFrames = output.written.filter(
      (message) =>
        (message.kind === 'update' && message.topic === 'hot') ||
        (message.kind === 'topic-gap' && message.topic === 'hot')
    );
    const gapIndex = hotFrames.findIndex((message) => message.kind === 'topic-gap');
    expect(gapIndex).toBeGreaterThanOrEqual(0);
    expect(hotFrames.filter((message) => message.kind === 'topic-gap')).toHaveLength(1);

    const afterGap = hotFrames.slice(gapIndex + 1);
    expect(afterGap.length).toBeGreaterThan(0);
    expect(afterGap.every((message) => message.kind === 'update')).toBe(true);

    const afterGapUpdates = afterGap.filter(
      (message): message is Extract<WireMessage, { kind: 'update' }> => message.kind === 'update'
    );
    const sequences = afterGapUpdates.map((message) => message.update.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(sequences[sequences.length - 1]).toBe(400);

    const deliveredHotUpdates = hotFrames.filter(
      (message): message is Extract<WireMessage, { kind: 'update' }> => message.kind === 'update'
    );
    const deliveredBytes = deliveredHotUpdates.reduce(
      (total, message) => total + encode(message).byteLength,
      0
    );
    expect(queue.skippedBytes).toBe(postedBytes - deliveredBytes);
  });

  it('keeps slow topics, control frames, and blob streams while a hot topic drops', () => {
    const { output, queue } = blockedQueue(undefined, 2 * 1024 * 1024);
    const chunk = 'y'.repeat(128 * 1024);

    queue.post(update('hot', 1, chunk));
    for (let sequence = 2; sequence <= 400; sequence++) queue.post(update('hot', sequence, chunk));
    queue.post(update('slow', 1));
    queue.post(update('slow', 2));
    queue.post({ kind: 'result', id: 'r1', ok: true, value: null });
    queue.post({ kind: 'result', id: 'r2', ok: true, value: null });
    queue.post(blobChunk(0, 1024));
    queue.post(blobChunk(1, 1024));
    queue.post({ kind: 'blob-end', channel: 'upload' });

    output.release();

    const names = output.written.map(label);
    expect(names.filter((name) => name.startsWith('slow:'))).toEqual(['slow:1', 'slow:2']);
    expect(names.filter((name) => name.startsWith('blob'))).toEqual([
      'blob:0',
      'blob:1',
      'blob-end',
    ]);
    const resultIds = output.written.flatMap((message) =>
      message.kind === 'result' ? [message.id] : []
    );
    expect(resultIds).toEqual(['r1', 'r2']);
  });

  it('fails the transport once every kind of queued frame passes the memory bound', () => {
    const { queue, overflows } = blockedQueue(1024 * 1024);
    queue.post(update('first', 1));
    for (let id = 0; id < 8; id++) {
      queue.post({ kind: 'result', id: `r${id}`, ok: true, value: 'y'.repeat(128 * 1024) });
    }
    expect(overflows).toHaveLength(1);
    expect(overflows[0]).toBeGreaterThan(1024 * 1024);
  });

  it('still calls onOverflow when non-droppable control frames pass maxQueuedBytes', () => {
    const { queue, overflows } = blockedQueue(1024);

    queue.post({ kind: 'result', id: 'first', ok: true, value: null });
    queue.post({ kind: 'result', id: 'second', ok: true, value: 'y'.repeat(2 * 1024) });

    expect(overflows).toHaveLength(1);
    expect(overflows[0]).toBeGreaterThan(1024);
  });

  it('replaces an oversized queued update with a topic-gap', () => {
    const { output, queue } = blockedQueue(undefined, 1024);
    const oversized = update('hot', 1, 'x'.repeat(2 * 1024));
    queue.post(update('blocker', 1));
    queue.post(oversized);

    output.release();

    expect(
      output.written.filter(
        (message): message is Extract<WireMessage, { kind: 'update' }> =>
          message.kind === 'update' && message.topic === 'hot'
      )
    ).toEqual([]);
    expect(
      output.written.filter((message) => message.kind === 'topic-gap' && message.topic === 'hot')
    ).toHaveLength(1);
    expect(queue.skippedBytes).toBe(encode(oversized).byteLength);
  });

  it('compacts 70 large topics into a single gap each before global overflow', () => {
    const maxQueuedBytes = 128 * 1024 * 1024;
    const { output, queue, overflows } = blockedQueue(maxQueuedBytes, 2 * 1024 * 1024);
    const chunk = 'x'.repeat(Math.floor(1.9 * 1024 * 1024));
    const topics = 70;

    queue.post({ kind: 'result', id: 'blocker', ok: true, value: null });
    for (let topic = 0; topic < topics; topic++) {
      queue.post(update(`topic-${topic}`, 1, chunk));
      queue.post(update(`topic-${topic}`, 2, chunk));
    }

    expect(overflows).toEqual([]);

    output.release();

    const gapCounts = new Map<string, number>();
    for (const message of output.written) {
      if (message.kind === 'topic-gap' && message.topic.startsWith('topic-')) {
        gapCounts.set(message.topic, (gapCounts.get(message.topic) ?? 0) + 1);
      }
    }

    expect(gapCounts.size).toBe(topics);
    for (const count of gapCounts.values()) expect(count).toBe(1);
  });

  it('writes straight through when the writer has no drain event', () => {
    const written: Uint8Array[] = [];
    const queue = createOutboundQueue(
      { write: (chunk) => written.push(chunk as Uint8Array) },
      encode,
      () => {}
    );
    queue.post(update('a', 1));
    queue.post(update('a', 2));
    expect(written).toHaveLength(2);
  });

  it('keeps a 6 MiB burst within one second when the writer drains after a second', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);
    const chunk = 'y'.repeat(128 * 1024);
    const count = 48;

    for (let sequence = 1; sequence <= count; sequence++) {
      queue.post(update('hot', sequence, chunk));
      time += 20;
    }
    time = 1000;
    output.release();

    expect(output.written.map(label)).toEqual(
      Array.from({ length: count }, (_, index) => `hot:${index + 1}`)
    );
    expect(queue.skippedBytes).toBe(0);
    expect(queue.skippedFrames).toBe(0);
  });

  it('turns a backlog older than the age limit into one gap and keeps newer updates after it', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);
    const dropped = [update('hot', 2), update('hot', 3), update('hot', 4)];

    queue.post(update('hot', 1));
    for (const message of dropped) queue.post(message);
    time = 4000;
    queue.post(update('hot', 5));
    output.release();

    expect(output.written.map(label)).toEqual(['hot:1', 'topic-gap', 'hot:5']);
    expect(queue.skippedBytes).toBe(
      dropped.reduce((total, message) => total + encode(message).byteLength, 0)
    );
    expect(queue.skippedFrames).toBe(dropped.length);
  });

  it('sends a gap first for a topic that goes quiet and whose backlog goes stale', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);

    queue.post(update('blocker', 1));
    queue.post(update('quiet', 1));
    queue.post(update('quiet', 2));
    time = 4000;
    output.release();

    const quiet = forTopic(output.written, 'quiet');
    expect(quiet.map(label)).toEqual(['topic-gap']);
    expect(queue.skippedFrames).toBe(2);
  });

  it('bounds one topic by the 16 MiB cap under an unbounded producer with a frozen clock', () => {
    const maxTopicBytes = 16 * 1024 * 1024;
    const { output, queue, overflows } = blockedQueue();
    const chunk = 'y'.repeat(128 * 1024);
    let maxQueued = 0;

    for (let sequence = 1; sequence <= 400; sequence++) {
      queue.post(update('hot', sequence, chunk));
      maxQueued = Math.max(maxQueued, queue.queuedBytes);
    }

    expect(overflows).toEqual([]);
    expect(maxQueued).toBeLessThanOrEqual(maxTopicBytes);
    expect(queue.skippedBytes).toBeGreaterThan(0);

    output.release();
    expect(forTopic(output.written, 'hot').filter((m) => m.kind === 'topic-gap')).toHaveLength(1);
  });

  it('loses nothing on a second slow topic while the first is dropped by age', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);

    queue.post(update('blocker', 1));
    queue.post(update('hot', 1));
    queue.post(update('hot', 2));
    time = 3500;
    queue.post(update('slow', 1));
    queue.post(update('slow', 2));
    time = 4000;
    output.release();

    expect(forTopic(output.written, 'slow').map(label)).toEqual(['slow:1', 'slow:2']);
    expect(forTopic(output.written, 'hot').map(label)).toEqual(['topic-gap']);
  });

  it('never drops a flow update by age while an unmarked update still is', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);

    queue.post(update('blocker', 1));
    queue.post({ ...update('credit', 1), flow: true } as WireMessage);
    queue.post({ ...update('credit', 2), flow: true } as WireMessage);
    queue.post(update('slow', 1));
    time = 4000;
    output.release();

    expect(forTopic(output.written, 'credit').map(label)).toEqual(['credit:1', 'credit:2']);
    expect(forTopic(output.written, 'slow').map(label)).toEqual(['topic-gap']);
  });

  it('drops nothing when the oldest queued update is exactly at the age limit', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);

    queue.post(update('hot', 1));
    queue.post(update('hot', 2));
    queue.post(update('hot', 3));
    time = 3000;
    queue.post(update('hot', 4));
    output.release();

    expect(output.written.map(label)).toEqual(['hot:1', 'hot:2', 'hot:3', 'hot:4']);
    expect(queue.skippedBytes).toBe(0);
    expect(queue.skippedFrames).toBe(0);
    expect(queue.queuedBytes).toBe(0);
  });

  it('turns the backlog into a gap one millisecond past the age limit', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);
    const dropped = [update('hot', 2), update('hot', 3)];

    queue.post(update('hot', 1));
    for (const message of dropped) queue.post(message);
    time = 3001;
    output.release();

    expect(output.written.map(label)).toEqual(['hot:1', 'topic-gap']);
    expect(queue.skippedBytes).toBe(totalBytes(dropped));
    expect(queue.skippedFrames).toBe(dropped.length);
    expect(queue.queuedBytes).toBe(0);
  });

  it('folds a second stale backlog into the gap that is still queued', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);
    const dropped = [update('hot', 2), update('hot', 3), update('hot', 4)];

    queue.post(update('hot', 1));
    queue.post(dropped[0]!);
    queue.post(dropped[1]!);
    time = 4000;
    queue.post(dropped[2]!);
    time = 8000;
    queue.post(update('hot', 5));
    output.release();

    expect(output.written.map(label)).toEqual(['hot:1', 'topic-gap', 'hot:5']);
    expect(queue.skippedBytes).toBe(totalBytes(dropped));
    expect(queue.skippedFrames).toBe(dropped.length);
    expect(queue.queuedBytes).toBe(0);
  });

  it('delivers a partly drained backlog in order and gaps only the part that ages out', () => {
    let time = 0;
    const { output, queue } = blockedQueue(undefined, undefined, () => time);
    const rest = update('hot', 4);
    const dropped = [rest, update('hot', 5), update('hot', 6)];

    queue.post(update('hot', 1));
    queue.post(update('hot', 2));
    queue.post(update('hot', 3));
    queue.post(rest);
    output.release(2);

    expect(output.written.map(label)).toEqual(['hot:1', 'hot:2', 'hot:3']);
    expect(queue.queuedBytes).toBe(encode(rest).byteLength);
    expect(queue.skippedFrames).toBe(0);

    time = 2000;
    queue.post(dropped[1]!);
    queue.post(dropped[2]!);
    time = 3500;
    output.release();

    expect(output.written.map(label)).toEqual(['hot:1', 'hot:2', 'hot:3', 'topic-gap']);
    expect(queue.skippedBytes).toBe(totalBytes(dropped));
    expect(queue.skippedFrames).toBe(dropped.length);
    expect(queue.queuedBytes).toBe(0);
  });
});

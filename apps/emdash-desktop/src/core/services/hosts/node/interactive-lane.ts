import { randomUUID } from 'node:crypto';
import type { Unsubscribe } from '@emdash/shared';
import type { Clock, TimerHandle } from '@emdash/shared/scheduling';
import {
  encodeTopic,
  WireError,
  type AttachOptions,
  type CallOptions,
  type Connection,
  type LiveUpdate,
} from '@emdash/wire/rpc';

/** Input calls whose session output follows them onto the interactive lane. */
const INPUT_OUTPUT_TOPICS: Record<string, (input: never) => string> = {
  'tuiAgents.sendInput': (input: { conversationId: string }) =>
    encodeTopic('tuiAgents.output', { conversationId: input.conversationId }),
  'terminals.sendInput': (input: { key: unknown }) => encodeTopic('terminals.output', input.key),
};
/** Input the TUI runtime can deduplicate, so it may be resent after a reconnect. */
const SEQUENCED_PATHS = new Set(['tuiAgents.sendInput']);
const RESIZE_PATHS = new Set(['tuiAgents.resize', 'terminals.resize']);
export const MAX_ACTIVE_SESSIONS = 2;
export const ACTIVE_IDLE_MS = 30_000;
export const MAX_PENDING_INPUTS = 1024;
export const MOVE_RETRY_MS = 1_000;

export type InteractiveLaneOptions = {
  clock: Clock;
  laneConnected(): boolean;
  /** Physical generation of the lane transport; attempts from older generations settle first. */
  laneGeneration(): number;
  onLaneReconnect(listener: () => void): Unsubscribe;
  /**
   * Identifies the daemon incarnation whose runtimes deduplicate sequenced input, or undefined
   * when the server cannot. Pending input is only resent within the scope it was sent in.
   */
  replayScope(): string | undefined;
};

/**
 * Routes keystrokes, resizes and the output of the sessions being typed into over a second Wire
 * channel, so bulk traffic on the first cannot queue ahead of an echo. At most
 * `MAX_ACTIVE_SESSIONS` recently typed sessions stay on the lane; a session idle for
 * `ACTIVE_IDLE_MS` or displaced by another returns to bulk.
 */
export function interactiveLaneConnection(
  bulk: Connection,
  lane: Connection,
  options: InteractiveLaneOptions
): Connection {
  const outputs = new Map<string, Set<LaneAttachment>>();
  const syncTopic = (topic: string): void => {
    for (const attachment of outputs.get(topic) ?? []) attachment.sync();
  };
  const active = createActiveSessions(options.clock, syncTopic);
  const channels = {
    bulk,
    lane,
    clock: options.clock,
    wantsLane: (topic: string) => active.has(topic),
  };
  const inputs = createInputReplay(lane, options);
  const unsubscribeReconnect = options.onLaneReconnect(() => inputs.pump());

  return {
    call(path, input, callOptions) {
      const outputTopic = INPUT_OUTPUT_TOPICS[path]?.(input as never);
      if (outputTopic === undefined) {
        return (RESIZE_PATHS.has(path) ? lane : bulk).call(path, input, callOptions);
      }
      active.touch(outputTopic);
      if (!SEQUENCED_PATHS.has(path)) return lane.call(path, input, callOptions);
      return inputs.send(path, input as Record<string, unknown>, outputTopic, callOptions);
    },
    snapshot: (topic, options) => (active.has(topic) ? lane : bulk).snapshot(topic, options),
    async attach(topic, push, attachOptions) {
      const attachment = new LaneAttachment(channels, topic, push, attachOptions);
      const set = outputs.get(topic) ?? new Set<LaneAttachment>();
      // Registered before attaching, so a promotion during the first attach is not missed.
      set.add(attachment);
      outputs.set(topic, set);
      const detach = (): void => {
        set.delete(attachment);
        attachment.dispose();
      };
      try {
        await attachment.start();
      } catch (error) {
        detach();
        throw error;
      }
      return detach;
    },
    openBlobConsumer: (channel) => bulk.openBlobConsumer(channel),
    openBlobProducer: (channel, source) => bulk.openBlobProducer(channel, source),
    onDisconnect(cb) {
      const offBulk = bulk.onDisconnect(cb);
      const offLane = lane.onDisconnect(cb);
      return () => {
        offBulk();
        offLane();
      };
    },
    dispose() {
      unsubscribeReconnect();
      for (const attachments of outputs.values()) {
        for (const attachment of attachments) attachment.dispose();
      }
      outputs.clear();
      active.dispose();
      inputs.dispose();
      bulk.dispose();
      lane.dispose();
    },
  };
}

/**
 * Recently typed sessions, oldest first. Every keystroke reports its topic as changed, which
 * also retries a move that failed; leaving the set (displaced or idle) reports it again.
 */
function createActiveSessions(clock: Clock, changed: (topic: string) => void) {
  const timers = new Map<string, TimerHandle>();
  const forget = (topic: string): void => {
    void timers.get(topic)?.dispose();
    timers.delete(topic);
  };
  const leave = (topic: string): void => {
    forget(topic);
    changed(topic);
  };
  return {
    has: (topic: string): boolean => timers.has(topic),
    touch(topic: string): void {
      forget(topic);
      timers.set(
        topic,
        clock.schedule(ACTIVE_IDLE_MS, () => leave(topic), { unref: true })
      );
      while (timers.size > MAX_ACTIVE_SESSIONS) leave(timers.keys().next().value!);
      changed(topic);
    },
    dispose(): void {
      for (const timer of timers.values()) void timer.dispose();
      timers.clear();
    },
  };
}

type Channels = {
  bulk: Connection;
  lane: Connection;
  clock: Clock;
  wantsLane(topic: string): boolean;
};

/**
 * One subscriber's output topic. A move attaches on the target channel before detaching the old
 * one, then signals a reattach so the replica reconciles from a snapshot: output still queued on
 * the old channel is recovered even if the session then goes silent. Updates seen on both
 * channels during the overlap are delivered once.
 */
class LaneAttachment {
  private onLane: boolean | undefined;
  private detach: Unsubscribe | undefined;
  private moving = false;
  private disposed = false;
  private retry: TimerHandle | undefined;
  private generation: number | undefined;
  private sequence = -1;

  constructor(
    private readonly channels: Channels,
    private readonly topic: string,
    private readonly push: (update: LiveUpdate) => void,
    private readonly options: AttachOptions | undefined
  ) {}

  async start(): Promise<void> {
    const onLane = this.channels.wantsLane(this.topic);
    this.detach = await this.attach(onLane);
    this.onLane = onLane;
    if (this.disposed) return this.detach();
    this.sync();
  }

  sync(): void {
    if (this.disposed || this.moving || this.onLane === undefined) return;
    const toLane = this.channels.wantsLane(this.topic);
    if (toLane !== this.onLane) void this.move(toLane);
  }

  dispose(): void {
    this.disposed = true;
    void this.retry?.dispose();
    this.detach?.();
  }

  private async move(toLane: boolean): Promise<void> {
    this.moving = true;
    let detach: Unsubscribe;
    try {
      detach = await this.attach(toLane);
    } catch {
      // Still served by the old channel. A failed demotion must not wait for a keystroke that
      // may never come, so every failed move retries on a timer until routing settles.
      this.moving = false;
      if (this.disposed) return;
      void this.retry?.dispose();
      this.retry = this.channels.clock.schedule(MOVE_RETRY_MS, () => this.sync(), { unref: true });
      return;
    }
    this.moving = false;
    if (this.disposed) return detach();
    const previous = this.detach;
    this.detach = detach;
    this.onLane = toLane;
    previous?.();
    this.options?.onReattach?.();
    // Routing may have changed while attaching.
    this.sync();
  }

  private attach(toLane: boolean): Promise<Unsubscribe> {
    const connection = toLane ? this.channels.lane : this.channels.bulk;
    return connection.attach(this.topic, (update) => this.deliver(update), this.options);
  }

  private deliver(update: LiveUpdate): void {
    if (update.generation === this.generation && update.sequence <= this.sequence) return;
    this.generation = update.generation;
    this.sequence = update.sequence;
    this.push(update);
  }
}

type PendingInput = {
  path: string;
  input: Record<string, unknown>;
  options: CallOptions | undefined;
  scope: string;
  sent: boolean;
  /** Lane generation of the attempt in flight, if any. */
  attempt: number | undefined;
  /** Clock time at which an explicit `timeoutMs` runs out, counted from when the input was queued. */
  deadlineAt: number | undefined;
  /** Stops the deadline timer and the abort listener. */
  cleanup(): void;
  resolve(value: unknown): void;
  reject(error: unknown): void;
};

/**
 * Sends sequenced input in order and keeps it until the server answers. Input rejected by a
 * disconnect is resent after the lane reconnects, marked as a replay, and only within the daemon
 * incarnation it was first sent to. The TUI runtime writes a replay only if the same PTY already
 * saw this writer and otherwise answers `input-unconfirmed`, so a key is not written twice by one
 * PTY incarnation and is never typed into a replacement session.
 */
function createInputReplay(lane: Connection, options: InteractiveLaneOptions) {
  const writer = randomUUID();
  const nextSeq = new Map<string, number>();
  const queue: PendingInput[] = [];

  const sequence = (target: string): number => {
    const seq = nextSeq.get(target) ?? 0;
    nextSeq.set(target, seq + 1);
    return seq;
  };

  const settle = (entry: PendingInput): void => {
    entry.cleanup();
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
  };

  // Cancellation and deadlines also apply while the input waits for the lane. An attempt in flight
  // is cancelled or timed out by the call itself.
  const abandon = (entry: PendingInput, error: WireError): void => {
    if (entry.attempt !== undefined || !queue.includes(entry)) return;
    settle(entry);
    entry.reject(error);
  };

  const cancelled = (sent: boolean) =>
    new WireError('CANCELLED', 'Wire call cancelled', sent ? {} : { delivery: 'not-sent' });
  const timedOut = (entry: PendingInput, timeoutMs: number) =>
    new WireError(
      'TIMEOUT',
      `Interactive input timed out after ${timeoutMs}ms`,
      entry.sent ? {} : { delivery: 'not-sent' }
    );

  const watch = (entry: PendingInput): void => {
    const timeoutMs = entry.options?.timeoutMs;
    const signal = entry.options?.signal;
    const timer =
      entry.deadlineAt !== undefined && timeoutMs !== undefined
        ? options.clock.schedule(timeoutMs, () => abandon(entry, timedOut(entry, timeoutMs)))
        : undefined;
    const onAbort = (): void => abandon(entry, cancelled(entry.sent));
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.cleanup = () => {
      void timer?.dispose();
      signal?.removeEventListener('abort', onAbort);
    };
  };

  const refuse = (entry: PendingInput): void => {
    settle(entry);
    entry.reject(
      new WireError('DISCONNECTED', 'Input was not confirmed before the host restarted')
    );
  };

  const asReplay = (input: Record<string, unknown>): Record<string, unknown> => ({
    ...input,
    sequence: { ...(input.sequence as object), replay: true },
  });

  const post = (entry: PendingInput, generation: number): void => {
    const input = entry.sent ? asReplay(entry.input) : entry.input;
    let callOptions = entry.options;
    if (entry.deadlineAt !== undefined && entry.options?.timeoutMs !== undefined) {
      const remaining = Math.ceil(entry.deadlineAt - options.clock.now());
      if (remaining <= 0) {
        abandon(entry, timedOut(entry, entry.options.timeoutMs));
        return;
      }
      callOptions = { ...entry.options, timeoutMs: remaining };
    }
    entry.sent = true;
    entry.attempt = generation;
    lane.call(entry.path, input, callOptions).then(
      (value) => {
        settle(entry);
        entry.resolve(value);
        pump();
      },
      (error: unknown) => {
        entry.attempt = undefined;
        if (!(error instanceof WireError && error.code === 'DISCONNECTED')) {
          settle(entry);
          entry.reject(error);
        }
        pump();
      }
    );
  };

  // Attempts from an older lane generation settle before anything is posted on the new one: a
  // newer key admitted first would make the gate take the older replays for duplicates.
  function pump(): void {
    if (!options.laneConnected()) return;
    const generation = options.laneGeneration();
    if (queue.some((entry) => entry.attempt !== undefined && entry.attempt !== generation)) return;
    const scope = options.replayScope();
    for (const entry of [...queue]) {
      if (entry.attempt !== undefined) continue;
      if (entry.scope === scope) post(entry, generation);
      else refuse(entry);
    }
  }

  return {
    send(
      path: string,
      input: Record<string, unknown>,
      target: string,
      callOptions: CallOptions | undefined
    ): Promise<unknown> {
      const scope = options.replayScope();
      if (scope === undefined) return lane.call(path, input, callOptions);
      if (callOptions?.signal?.aborted) return Promise.reject(cancelled(false));
      if (queue.length >= MAX_PENDING_INPUTS) {
        return Promise.reject(
          new WireError('DISCONNECTED', 'Interactive input buffer is full', {
            delivery: 'not-sent',
          })
        );
      }
      return new Promise((resolve, reject) => {
        const timeoutMs = callOptions?.timeoutMs;
        const entry: PendingInput = {
          path,
          input: { ...input, sequence: { writer, seq: sequence(target) } },
          options: callOptions,
          scope,
          sent: false,
          attempt: undefined,
          deadlineAt:
            timeoutMs !== undefined && timeoutMs > 0 ? options.clock.now() + timeoutMs : undefined,
          cleanup: () => {},
          resolve,
          reject,
        };
        watch(entry);
        queue.push(entry);
        pump();
      });
    },
    pump,
    dispose(): void {
      for (const entry of queue.splice(0)) {
        entry.cleanup();
        entry.reject(new WireError('DISCONNECTED', 'Wire connection disposed'));
      }
    },
  };
}

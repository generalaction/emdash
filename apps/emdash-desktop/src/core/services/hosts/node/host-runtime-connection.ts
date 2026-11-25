import { workspaceWireContract, type WireInitializeResult } from '@emdash/core/workspace-server';
import type { Scope } from '@emdash/shared/concurrency';
import { runWithTimeout, waitWithSignal, type Clock } from '@emdash/shared/scheduling';
import {
  client,
  connect,
  replaceableTransport,
  type Connection,
  type ReplaceableTransport,
  type ContractClient,
  type WireTransport,
} from '@emdash/wire/rpc';
import type { WorkspaceServerTarget } from '../api/targets';
import { BulkWindowController } from './bulk-window';
import { interactiveLaneConnection } from './interactive-lane';
import {
  transportFlow,
  type TransportFlow,
} from './workspace-server/connect/owned-stream-transport';
import { initializeWorkspaceServerTransport } from './workspace-server/connect/protocol';

/** First protocol minor whose TUI runtimes deduplicate sequenced input. */
const SEQUENCED_INPUT_MINOR = 3;

/** How often the bulk window is re-evaluated while bulk bytes are arriving. */
const RTT_PROBE_MS = 200;

export type HostRuntimeConnectionOptions = {
  scope: Scope;
  clock: Clock;
  open(target: WorkspaceServerTarget, signal: AbortSignal): Promise<WireTransport>;
  openTimeoutMs: number;
  initializeTimeoutMs: number;
  healthTimeoutMs: number;
  client?: { id: string; appVersion: string };
  onDisconnect(): void;
  onRequestTimeout(): void;
  /** Opens a second Wire channel for interactive traffic and health probes. */
  interactiveLane?: boolean;
  /** Sizes the bulk channel's receive window from the lane's round-trip time. Needs `interactiveLane`. */
  adaptiveBulkWindow?: boolean;
};

/**
 * Owns Wire resources and single attempts. Recovery policy belongs to the supervisor.
 * With `interactiveLane`, each physical generation has two Wire channels to the daemon: bulk,
 * and a lane for keystrokes, typed sessions' output and health probes, so a bulk backlog cannot
 * starve them.
 */
export class HostRuntimeConnection {
  readonly connection: Connection;
  readonly client: ContractClient<typeof workspaceWireContract>;
  private readonly scope: Scope;
  private readonly transport = replaceableTransport();
  private readonly laneTransport: ReplaceableTransport | undefined;
  private handshake: WireInitializeResult | undefined;
  /** Handshake of the channel that carries input: the lane when there is one. */
  private inputHandshake: WireInitializeResult | undefined;
  private opening: Scope | undefined;
  private stopTuner: (() => void) | undefined;

  constructor(private readonly options: HostRuntimeConnectionOptions) {
    this.scope = options.scope.child('host-runtime-connection');
    this.laneTransport = options.interactiveLane ? replaceableTransport() : undefined;
    this.connection = this.laneTransport
      ? this.connectWithLane(this.laneTransport)
      : this.connectWire(this.transport);
    this.client = client(workspaceWireContract, this.connection);
    for (const transport of this.transports()) {
      this.scope.add(
        transport.onDisconnect(() => {
          if (!this.scope.disposed) options.onDisconnect();
        })
      );
    }
    const close = (): void => {
      for (const transport of this.transports()) transport.close();
    };
    this.scope.signal.addEventListener('abort', close, { once: true });
    if (this.scope.signal.aborted) close();
    this.scope.add(() => this.stopTuning());
    this.scope.add(() => this.connection.dispose());
  }

  /** Every channel is installed; this is not a claim of fresh responsiveness. */
  get connected(): boolean {
    return this.transports().every((transport) => transport.connected);
  }

  /** Physical Wire generation for diagnostics and conditional detach, distinct from Host readiness. */
  get generation(): number {
    return this.transport.generation;
  }

  get currentHandshake(): WireInitializeResult | undefined {
    return this.connected ? this.handshake : undefined;
  }

  /** One bounded open + initialize + install. New attempts supersede unfinished ones. */
  async establish(target: WorkspaceServerTarget, callerSignal: AbortSignal): Promise<void> {
    this.scope.signal.throwIfAborted();
    callerSignal.throwIfAborted();
    this.stopTuning();
    void this.opening?.dispose(new Error('Runtime connection attempt superseded'));
    const opening = this.scope.child('establish');
    this.opening = opening;
    const signal = AbortSignal.any([callerSignal, opening.signal, this.scope.signal]);
    const candidates: WireTransport[] = [];
    let installed = false;
    try {
      const opened = await Promise.all(
        this.transports().map(() => this.openInitialized(target, signal, candidates))
      );
      signal.throwIfAborted();
      const handshakes = opened.map((channel) => channel.handshake);
      assertSameServer(handshakes);
      this.handshake = handshakes[0];
      this.inputHandshake = handshakes.at(-1);
      this.transports().forEach((transport, index) => transport.install(opened[index]!.transport));
      if (!this.connected) throw new Error('Host disconnected during initialization');
      installed = true;
      this.tuneBulkWindow(opened[0]!.transport);
    } finally {
      if (!installed) for (const candidate of candidates) candidate.close?.();
      if (this.opening === opening) this.opening = undefined;
      await opening.dispose();
    }
  }

  /**
   * Health evidence applies only to the physical transport that received the request. Probes use
   * the interactive lane: a backlog on the bulk channel is congestion, not a dead host.
   */
  async probe(callerSignal: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([callerSignal, this.scope.signal]);
    signal.throwIfAborted();
    const probed = this.laneTransport ?? this.transport;
    const physical = probed.current;
    const generation = probed.generation;
    if (!physical) throw new Error('Host attachment is unavailable');
    // Probe the physical transport directly: never queue or replay on its replacement.
    const connection = connect(physical, {
      clock: this.options.clock,
      callTimeoutMs: this.options.healthTimeoutMs,
    });
    try {
      await client(workspaceWireContract, connection).health(undefined, { signal });
      if (generation !== probed.generation) throw new Error('Superseded health response');
    } finally {
      connection.dispose();
    }
  }

  /** Release physical resources while retaining logical client/subscription identity. */
  detach(expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== this.generation) return;
    this.stopTuning();
    void this.opening?.dispose(new Error('Runtime connection detached'));
    for (const transport of this.transports()) transport.detach();
  }

  dispose(): Promise<void> {
    return this.scope.dispose();
  }

  private transports(): ReplaceableTransport[] {
    return this.laneTransport ? [this.transport, this.laneTransport] : [this.transport];
  }

  private tuneBulkWindow(bulk: WireTransport): void {
    const flow =
      this.laneTransport && this.options.adaptiveBulkWindow ? transportFlow(bulk) : undefined;
    if (!flow) return;
    this.stopTuner = startBulkWindowTuner({
      clock: this.options.clock,
      flow,
      probeLane: (signal) => this.healthOnLane(signal),
    });
  }

  private stopTuning(): void {
    this.stopTuner?.();
    this.stopTuner = undefined;
  }

  private async healthOnLane(signal: AbortSignal): Promise<void> {
    const physical = this.laneTransport?.current;
    if (!physical) throw new Error('Host attachment is unavailable');
    const connection = connect(physical, {
      clock: this.options.clock,
      callTimeoutMs: this.options.healthTimeoutMs,
    });
    try {
      await client(workspaceWireContract, connection).health(undefined, { signal });
    } finally {
      connection.dispose();
    }
  }

  private connectWithLane(lane: ReplaceableTransport): Connection {
    return interactiveLaneConnection(
      this.connectWire(this.transport, { credit: 64 * 1024 }),
      this.connectWire(lane),
      {
        clock: this.options.clock,
        laneConnected: () => lane.connected,
        laneGeneration: () => lane.generation,
        onLaneReconnect: (listener) => lane.onReconnect(listener),
        replayScope: () => this.replayScope(),
      }
    );
  }

  // The last handshake, not the current one: input typed while disconnected must still queue.
  private replayScope(): string | undefined {
    const handshake = this.inputHandshake;
    if (!handshake || handshake.agreedMinor < SEQUENCED_INPUT_MINOR) return undefined;
    return `${handshake.server.daemonId}:${handshake.server.startedAt}`;
  }

  private connectWire(
    transport: WireTransport,
    options?: { credit?: number }
  ): Connection {
    const { onRequestTimeout } = this.options;
    const creditWindow = options?.credit;
    return connect(transport, {
      clock: this.options.clock,
      maxHeldCalls: 0,
      ...(creditWindow === undefined ? {} : { creditWindow }),
      instrumentation: {
        callEnd: ({ errorCode }) => {
          if (errorCode === 'TIMEOUT') onRequestTimeout();
        },
        snapshot: ({ errorCode }) => {
          if (errorCode === 'TIMEOUT') onRequestTimeout();
        },
      },
    });
  }

  private async openInitialized(
    target: WorkspaceServerTarget,
    signal: AbortSignal,
    candidates: WireTransport[]
  ): Promise<{ transport: WireTransport; handshake: WireInitializeResult }> {
    const transport = await this.openCandidate(target, signal);
    candidates.push(transport);
    const handshake = await runWithTimeout(
      (inner) =>
        waitWithSignal(
          initializeWorkspaceServerTransport(transport, undefined, this.options.client),
          inner
        ),
      { signal, clock: this.options.clock, timeoutMs: this.options.initializeTimeoutMs }
    );
    return { transport, handshake };
  }

  private async openCandidate(
    target: WorkspaceServerTarget,
    signal: AbortSignal
  ): Promise<WireTransport> {
    let accepted = false;
    let pending: Promise<WireTransport> | undefined;
    try {
      const candidate = await runWithTimeout(
        (inner) => {
          pending = this.options.open(target, inner);
          return pending;
        },
        { signal, clock: this.options.clock, timeoutMs: this.options.openTimeoutMs }
      );
      accepted = true;
      return candidate;
    } finally {
      if (!accepted)
        void pending?.then(
          (late) => late.close?.(),
          () => {}
        );
    }
  }
}

/**
 * Sizes one bulk channel's receive window from lane round-trip times. While bulk bytes arrive it
 * measures the lane with a health call every RTT_PROBE_MS. Returns a function that stops it.
 */
function startBulkWindowTuner(options: {
  clock: Clock;
  flow: TransportFlow;
  probeLane(signal: AbortSignal): Promise<void>;
}): () => void {
  const { clock, flow, probeLane } = options;
  const controller = new BulkWindowController();
  const stopped = new AbortController();
  let appliedWindow = controller.windowBytes;
  let receivedSinceTick = false;
  let probing = false;
  let timer: ReturnType<Clock['schedule']> | undefined;

  const unsubscribe = flow.onReceived((bytes) => {
    receivedSinceTick = true;
    controller.received(bytes, clock.now());
  });

  const measure = async (): Promise<void> => {
    probing = true;
    try {
      const started = clock.now();
      await probeLane(stopped.signal);
      if (stopped.signal.aborted) return;
      const now = clock.now();
      controller.sample(now - started, now);
      if (controller.windowBytes === appliedWindow) return;
      appliedWindow = controller.windowBytes;
      flow.setReceiveWindow(appliedWindow);
    } catch {
      // The supervisor's own probes judge health; a failed sample just yields no data.
    } finally {
      probing = false;
    }
  };

  const arm = (): void => {
    timer = clock.schedule(RTT_PROBE_MS, tick, { unref: true });
  };

  function tick(): void {
    arm();
    if (!receivedSinceTick || probing) return;
    receivedSinceTick = false;
    void measure();
  }

  arm();
  return () => {
    stopped.abort();
    void timer?.dispose();
    unsubscribe();
  };
}

/** Both channels must reach one daemon incarnation with one feature level, or neither is used. */
function assertSameServer(handshakes: WireInitializeResult[]): void {
  const [first, ...rest] = handshakes;
  for (const other of rest) {
    if (
      other.server.daemonId !== first!.server.daemonId ||
      other.server.startedAt !== first!.server.startedAt ||
      other.agreedMinor !== first!.agreedMinor
    ) {
      throw new Error('Workspace server channels reached different daemon incarnations');
    }
  }
}

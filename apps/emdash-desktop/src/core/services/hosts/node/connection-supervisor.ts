import type { HostRef } from '@emdash/core/primitives/host/api';
import {
  runtimeHostUnavailable,
  type RuntimeResolveError,
} from '@emdash/core/primitives/runtime-resolution/api';
import { workspaceWireContract, type WireInitializeResult } from '@emdash/core/workspace-server';
import { ok, err, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import {
  retrySchedule,
  runWithTimeout,
  systemClock,
  waitWithSignal,
  type Clock,
  type TimerHandle,
  type RetrySchedule,
} from '@emdash/shared/scheduling';
import { client, connect, replaceableTransport, type WireTransport } from '@emdash/wire/rpc';
import { cell, derived, peek, snapshot, type Readable } from '@emdash/wire/state';
import { SshConnectionFailure } from '@core/primitives/ssh/api/node/connection-control';
import type {
  HostAvailabilityState,
  HostDemandMode,
  HostPreparingPhase,
} from '../api/availability';
import type { HostConnection } from '../api/node/host-connection';
import type { WorkspaceServerTarget } from '../api/targets';
import { translateHostPreparationError } from './runtime-resolution';
import type { HostServerOperationOwner } from './server-operations';
import { initializeWorkspaceServerTransport } from './workspace-server/connect/protocol';
import type { WorkspaceServerConnection } from './workspace-server/connect/wire-connection-manager';

export type SupervisorWakeCause = 'online' | 'focus' | 'resume' | 'rpc-timeout' | 'retry' | 'timer';
export type HostConnectionState =
  | { kind: 'idle' | 'stopped' }
  | { kind: 'paused'; reason: 'operation' | 'stopped' | 'failed'; issue?: RuntimeResolveError }
  | {
      kind: 'connecting' | 'recovering';
      phase: HostPreparingPhase;
      attempt: number;
      issue?: RuntimeResolveError;
      nextAttemptAt?: number;
    }
  | { kind: 'checking'; generation: number }
  | { kind: 'ready'; generation: number }
  | { kind: 'blocked'; layer: 'ssh' | 'runtime'; issue: RuntimeResolveError };

export type HostConnectionSupervisorOptions = {
  scope: Scope;
  nextGeneration?(): number;
  host: HostRef;
  intent: { read(): Promise<boolean>; write(enabled: boolean): Promise<void> };
  ssh: {
    connected(): boolean;
    establish(signal: AbortSignal): Promise<void>;
    reset(): void;
    probe(signal: AbortSignal): Promise<void>;
  };
  runtime: {
    prepare(signal: AbortSignal): Promise<WorkspaceServerTarget>;
    open(target: WorkspaceServerTarget, signal: AbortSignal): Promise<WireTransport>;
    cancel(): void;
  };
  clock?: Clock;
  random?: () => number;
  retrySchedule?: RetrySchedule;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  openTimeoutMs?: number;
  initializeTimeoutMs?: number;
  preparationTimeoutMs?: number;
  client?: { id: string; appVersion: string };
  onReady?(attachment: WorkspaceServerConnection): void;
  log?(state: HostConnectionState, detail: Record<string, unknown>): void;
};

type Waiter = { kind: 'ssh' | 'runtime'; resolve(): void; reject(error: unknown): void };

/** One lifecycle owner; physical adapters never schedule another recovery loop. */
export class HostConnectionSupervisor {
  private readonly stateCell = cell<HostConnectionState>({ kind: 'idle' });
  readonly state: Readable<HostConnectionState> = this.stateCell;
  // This total projection always has a value; unlike async queries it cannot be loading.
  readonly availability = derived(() =>
    projectAvailability(snapshot(this.state).value)
  ) as Readable<HostAvailabilityState>;
  readonly control: HostConnection = {
    availability: this.availability,
    demand: (mode, owner) => this.demand(mode, owner),
    requestConnect: () => this.result(this.requestConnect()),
    ensureReady: (cause, signal) =>
      this.result(
        (async () => {
          if (cause === 'connect' || cause === 'retry') await this.requestConnect();
          const generation = await this.awaitUsable(signal);
          return { host: this.options.host, generation };
        })()
      ),
    revalidate: (cause) => this.revalidate(cause),
    disconnect: () => this.disconnect(),
  };
  readonly attachment: WorkspaceServerConnection;
  private readonly scope: Scope;
  private readonly clock: Clock;
  private operations: Scope;
  private readonly transport = replaceableTransport();
  private readonly waiters = new Set<Waiter>();
  private readonly demands = new Set<{ mode: HostDemandMode }>();
  private enabled: boolean | undefined;
  private explicitRuntime = false;
  private runtimePolicy:
    | { kind: 'active' }
    | { kind: 'paused'; reason: 'operation' | 'stopped' | 'failed'; issue?: RuntimeResolveError }
    | { kind: 'blocked'; issue: RuntimeResolveError } = { kind: 'active' };
  private readonly retrySchedule: RetrySchedule;
  private lastCause = 'startup';
  private target: WorkspaceServerTarget | undefined;
  private handshake: WireInitializeResult | undefined;
  private generation = 0;
  private epoch = 0;
  private active: Scope | undefined;
  private timer: TimerHandle | undefined;
  private lastValidatedAt = 0;
  private lastFocusAt = -Infinity;
  private lastOnlineAt = -Infinity;
  private intentRevision = 0;
  private stopRevision = 0;
  private intentWrites: Promise<void> = Promise.resolve();
  private intentRead: Promise<void> | undefined;
  private systemSuspended = false;
  private resettingSsh = false;

  constructor(private readonly options: HostConnectionSupervisorOptions) {
    this.scope = options.scope.child('host-connection');
    this.operations = this.scope.child('server-operations');
    this.clock = options.clock ?? systemClock;
    this.retrySchedule =
      options.retrySchedule ??
      retrySchedule({
        delaysMs: [500, 1_000, 2_000, 5_000, 10_000, 20_000, 30_000],
        repeatLast: true,
        jitter: { random: options.random },
      });
    const connection = connect(this.transport, {
      clock: this.clock,
      maxHeldCalls: 0,
      instrumentation: {
        callEnd: ({ errorCode }) => {
          if (errorCode === 'TIMEOUT') this.revalidate('rpc-timeout');
        },
        snapshot: ({ errorCode }) => {
          if (errorCode === 'TIMEOUT') this.revalidate('rpc-timeout');
        },
      },
    });
    const target = () => {
      if (!this.target) throw new Error('Host attachment is not initialized');
      return this.target;
    };
    this.attachment = {
      get target() {
        return target();
      },
      connection,
      client: client(workspaceWireContract, connection),
      ready: async () => {
        await this.awaitUsable();
        if (!this.handshake) throw new Error('Host handshake is unavailable');
        return this.handshake;
      },
      currentHandshake: () => (this.transport.connected ? this.handshake : undefined),
    };
    this.transport.onDisconnect(() => {
      if (
        this.scope.disposed ||
        this.enabled !== true ||
        this.systemSuspended ||
        !this.runtimeWanted
      )
        return;
      void this.timer?.dispose();
      this.timer = undefined;
      this.publish({ kind: 'recovering', phase: 'handshaking', attempt: 1 });
      if (!this.active) this.start();
    });
    this.scope.signal.addEventListener(
      'abort',
      () => {
        this.cancel();
        this.options.runtime.cancel();
        this.resetSsh();
        this.transport.close();
        this.publish({ kind: 'idle' });
        this.rejectWaiters(this.runtimeUnavailable('Host identity disposed'));
      },
      { once: true }
    );
    this.scope.add(() => {
      connection.dispose();
    });
  }

  demand(mode: HostDemandMode, owner: Scope) {
    const lease = { mode };
    if (owner.disposed || this.scope.disposed) return { mode, setMode() {} };
    this.demands.add(lease);
    const activate = () => {
      if (lease.mode !== 'automatic' || this.runtimePaused) return;
      void this.restore().catch(() => {});
    };
    activate();
    owner.add(() => {
      this.demands.delete(lease);
      if (lease.mode === 'automatic') this.releaseRuntime();
    });
    return {
      get mode() {
        return lease.mode;
      },
      setMode: (next: HostDemandMode) => {
        if (!this.demands.has(lease)) return;
        if (lease.mode === next) return;
        lease.mode = next;
        if (next === 'automatic') activate();
        else this.releaseRuntime();
      },
    };
  }

  private get sshBlocked(): boolean {
    const state = peek(this.state);
    return state.kind === 'blocked' && state.layer === 'ssh';
  }

  private get runtimePaused(): boolean {
    return this.runtimePolicy.kind === 'paused';
  }

  private get runtimeBlock(): RuntimeResolveError | undefined {
    return this.runtimePolicy.kind === 'blocked' ? this.runtimePolicy.issue : undefined;
  }

  private get runtimeWanted(): boolean {
    return (
      !this.runtimePaused &&
      (this.explicitRuntime || [...this.demands].some((demand) => demand.mode === 'automatic'))
    );
  }

  private releaseRuntime(): void {
    if (this.scope.disposed || this.runtimeWanted || this.runtimePaused) return;
    this.cancel();
    this.transport.detach();
    this.rejectWaiters(this.runtimeUnavailable('Runtime demand released'), 'runtime');
    // Lease ownership never clears an actionable block or disconnected intent.
    if (this.enabled && peek(this.state).kind !== 'blocked') {
      this.publish({ kind: 'idle' });
      this.start();
    }
  }

  private async result<T>(work: Promise<T>): Promise<Result<T, RuntimeResolveError>> {
    try {
      return ok(await work);
    } catch (error) {
      return err(translateHostPreparationError(this.options.host, 'handshaking', error));
    }
  }

  private runtimeUnavailable(message: string): RuntimeResolveError {
    return runtimeHostUnavailable(this.options.host, 'runtime-unavailable', message);
  }

  async restore(): Promise<void> {
    if (this.scope.disposed) throw this.runtimeUnavailable('Host identity disposed');
    if (this.enabled === undefined) {
      const revision = this.intentRevision;
      this.intentRead ??= this.options.intent
        .read()
        .then((enabled) => {
          if (this.scope.disposed || this.intentRevision !== revision) return;
          this.enabled = enabled;
          if (!enabled) this.publish({ kind: 'stopped' });
        })
        .catch((error: unknown) => {
          if (!this.scope.disposed && this.intentRevision === revision) {
            this.publish({
              kind: 'blocked',
              layer: 'ssh',
              issue: translateHostPreparationError(this.options.host, 'connecting', error),
            });
          }
          throw error;
        })
        .finally(() => {
          this.intentRead = undefined;
        });
      await this.intentRead;
    }
    if (this.enabled) this.start();
  }

  async connect(runtime = true): Promise<void> {
    await this.requestConnect(runtime);
    await this.wait(runtime ? 'runtime' : 'ssh');
  }

  async requestConnect(runtime = true): Promise<void> {
    if (this.scope.disposed) throw this.runtimeUnavailable('Host identity disposed');
    if (
      runtime &&
      this.runtimePolicy.kind === 'paused' &&
      this.runtimePolicy.reason === 'operation'
    ) {
      throw this.runtimeUnavailable('A workspace server operation is in progress');
    }
    this.intentRevision += 1;
    this.lastCause = 'connect';
    const stopRevision = this.stopRevision;
    try {
      await this.writeIntent(true);
    } catch (error) {
      if (!this.scope.disposed && this.stopRevision === stopRevision)
        this.publish({
          kind: 'blocked',
          layer: 'ssh',
          issue: translateHostPreparationError(this.options.host, 'connecting', error),
        });
      throw error;
    }
    if (this.stopRevision !== stopRevision || this.scope.disposed)
      throw new Error('Host Connect was superseded');
    if (
      runtime &&
      this.runtimePolicy.kind === 'paused' &&
      this.runtimePolicy.reason === 'operation'
    ) {
      throw this.runtimeUnavailable('A workspace server operation is in progress');
    }
    this.enabled = true;
    if (this.operations.disposed) this.operations = this.scope.child('server-operations');
    if (runtime) {
      this.runtimePolicy = { kind: 'active' };
    }
    this.explicitRuntime ||= runtime;
    if (this.sshBlocked || peek(this.state).kind === 'stopped') {
      this.publish({ kind: 'idle' });
    }
    if (runtime && (peek(this.state).kind === 'ready' || peek(this.state).kind === 'recovering'))
      this.revalidate('retry');
    else this.start();
  }

  async ensureSsh(signal?: AbortSignal): Promise<void> {
    await (signal ? waitWithSignal(this.restore(), signal) : this.restore());
    await this.wait('ssh', signal);
  }

  getAttachment(): WorkspaceServerConnection {
    return this.attachment;
  }

  async awaitUsable(signal?: AbortSignal): Promise<number> {
    if (this.runtimePaused) throw this.runtimeUnavailable('Workspace server is stopped');
    if (!this.runtimeWanted)
      throw this.runtimeUnavailable('Host runtime requires an active demand');
    await (signal ? waitWithSignal(this.restore(), signal) : this.restore());
    await this.wait('runtime', signal);
    return this.generation;
  }

  revalidate(cause: SupervisorWakeCause): void {
    if (this.scope.disposed || this.systemSuspended || this.enabled !== true) return;
    const state = peek(this.state);
    this.lastCause = cause;
    if (this.sshBlocked && cause !== 'retry') return;
    if (cause === 'focus') {
      if (this.clock.now() - this.lastFocusAt < 30_000) return;
      this.lastFocusAt = this.clock.now();
    }
    if (cause === 'online') {
      if (this.clock.now() - this.lastOnlineAt < 30_000) return;
      this.lastOnlineAt = this.clock.now();
    }
    if (cause === 'retry' && state.kind === 'blocked') {
      this.runtimePolicy = { kind: 'active' };
      this.publish({ kind: 'idle' });
    }
    if (this.active) {
      if (cause !== 'retry' || state.kind !== 'recovering' || state.nextAttemptAt === undefined)
        return;
      this.cancel();
    }
    void this.timer?.dispose();
    this.timer = undefined;
    if (
      !this.transport.connected &&
      ((this.runtimeWanted && !this.runtimeBlock) || !this.options.ssh.connected())
    ) {
      this.start();
      return;
    }
    const wireProbe = this.transport.connected;
    const attemptScope = this.scope.child('connection-attempt');
    this.active = attemptScope;
    if (cause !== 'timer' && !this.runtimeBlock)
      this.publish({ kind: 'checking', generation: this.generation });
    const epoch = this.epoch;
    void attemptScope
      .run('validate', async () => {
        const validation = wireProbe
          ? this.probeWire(attemptScope.signal)
          : runWithTimeout((signal) => this.options.ssh.probe(signal), {
              signal: attemptScope.signal,
              clock: this.clock,
              timeoutMs: this.options.healthTimeoutMs ?? 5_000,
            });
        await validation.then(
          () => {
            if (!this.isCurrent(attemptScope, epoch)) return;
            this.lastValidatedAt = this.clock.now();
            this.publish(
              wireProbe
                ? { kind: 'ready', generation: this.generation }
                : this.runtimeBlock
                  ? { kind: 'blocked', layer: 'runtime', issue: this.runtimeBlock }
                  : { kind: 'idle' }
            );
            this.resolveWaiters();
          },
          () => {
            if (!this.isCurrent(attemptScope, epoch)) return;
            this.publish({ kind: 'recovering', phase: 'handshaking', attempt: 1 });
            this.transport.detach();
            if (!wireProbe) this.resetSsh();
          }
        );
      })
      .exit.then(() => this.finishAttempt(attemptScope, epoch));
  }

  sshDisconnected(): void {
    if (this.resettingSsh || this.scope.disposed || !this.enabled || this.sshBlocked) return;
    this.transport.detach();
    this.publish({ kind: 'recovering', phase: 'connecting', attempt: 1 });
    if (!this.active) this.start();
  }

  suspendSystem(): void {
    if (this.scope.disposed) return;
    this.systemSuspended = true;
    const pending = this.active !== undefined;
    this.cancel();
    if (pending && !this.transport.connected) this.resetSsh();
    if (this.enabled && peek(this.state).kind !== 'blocked')
      this.publish({ kind: 'checking', generation: this.generation });
  }

  resume(): void {
    if (this.scope.disposed) return;
    this.systemSuspended = false;
    // Resume may arrive without suspend (or after the event loop was paused).
    this.cancel();
    if (this.runtimeWanted && !this.runtimeBlock && !this.transport.connected) this.resetSsh();
    this.revalidate('resume');
  }

  async disconnect(): Promise<void> {
    if (this.scope.disposed) throw this.runtimeUnavailable('Host identity disposed');
    this.stopRevision += 1;
    this.intentRevision += 1;
    this.enabled = false;
    void this.operations.dispose(new Error('Host was disconnected'));
    this.explicitRuntime = false;
    this.cancel();
    this.publish({ kind: 'stopped' });
    this.rejectWaiters(new Error('Host was disconnected'));
    this.options.runtime.cancel();
    this.transport.detach();
    this.resetSsh();
    await this.writeIntent(false);
  }

  /** Cancels runtime recovery for an explicit server lifecycle operation. */
  pauseRuntime(
    issue?: RuntimeResolveError,
    reason: 'operation' | 'stopped' | 'failed' = 'stopped'
  ): void {
    this.cancel();
    this.runtimePolicy = { kind: 'paused', reason, issue };
    this.rejectWaiters(this.runtimeUnavailable('Workspace server is stopped'), 'runtime');
    this.target = undefined;
    this.transport.detach();
    this.publish({ kind: 'idle' });
    this.start();
  }

  resumeRuntime(): void {
    this.runtimePolicy = { kind: 'active' };
    this.explicitRuntime = true;
    this.revalidate('retry');
  }

  serverOperationOwner(): HostServerOperationOwner {
    const scope = this.operations;
    let paused = false;
    return {
      scope,
      before: async (action, signal) => {
        await this.ensureSsh(signal);
        signal.throwIfAborted();
        if (!action.startsWith('refresh')) {
          this.pauseRuntime(undefined, 'operation');
          paused = true;
        }
      },
      settled: (action, result) => {
        if (!paused || scope.disposed || this.scope.disposed || this.operations !== scope) return;
        if (result.success) {
          if (action !== 'stop') this.resumeRuntime();
          else this.pauseRuntime();
        } else {
          this.pauseRuntime(
            translateHostPreparationError(this.options.host, 'provisioning', result.error),
            'failed'
          );
        }
      },
    };
  }

  async dispose(): Promise<void> {
    await this.scope.dispose();
  }

  private start(): void {
    if (this.active || this.scope.disposed || this.systemSuspended || !this.enabled) return;
    if (this.sshBlocked) return;
    if (
      this.options.ssh.connected() &&
      (!this.runtimeWanted || this.transport.connected || this.runtimeBlock)
    ) {
      this.resolveWaiters();
      this.scheduleHealth();
      return;
    }
    void this.timer?.dispose();
    this.timer = undefined;
    const attemptScope = this.scope.child('connection-attempt');
    this.active = attemptScope;
    const epoch = this.epoch;
    void attemptScope
      .run('recover', () => this.recover(attemptScope, epoch))
      .exit.then(() => this.finishAttempt(attemptScope, epoch));
  }

  private finishAttempt(attempt: Scope, epoch: number): void {
    const current = this.isCurrent(attempt, epoch);
    void attempt.dispose();
    if (!current) return;
    this.active = undefined;
    if (
      this.transport.connected ||
      ((!this.runtimeWanted || this.runtimeBlock) && this.options.ssh.connected())
    ) {
      this.scheduleHealth();
    } else if (peek(this.state).kind === 'recovering') {
      // A disconnect may arrive after readiness settles but before this run exits.
      this.start();
    }
  }

  private async recover(attemptScope: Scope, epoch: number): Promise<void> {
    const signal = attemptScope.signal;
    let attempt = 0;
    while (this.isCurrent(attemptScope, epoch)) {
      attempt += 1;
      let phase: HostPreparingPhase = 'connecting';
      const progress = (next: HostPreparingPhase) => {
        phase = next;
        this.publish({ kind: this.generation ? 'recovering' : 'connecting', phase, attempt });
      };
      try {
        progress('connecting');
        await waitWithSignal(this.options.ssh.establish(signal), signal);
        this.lastValidatedAt = this.clock.now();
        this.resolveWaiters();
        if (this.runtimeBlock) {
          this.publish({ kind: 'blocked', layer: 'runtime', issue: this.runtimeBlock });
          return;
        }
        if (!this.runtimeWanted) {
          this.publish({ kind: 'idle' });
          return;
        }
        progress('provisioning');
        this.target ??= await runWithTimeout((inner) => this.options.runtime.prepare(inner), {
          signal,
          clock: this.clock,
          timeoutMs: this.options.preparationTimeoutMs ?? 120_000,
        });
        progress('handshaking');
        const candidate = await this.openCandidate(this.target, signal);
        try {
          const handshake = await runWithTimeout(
            (inner) =>
              waitWithSignal(
                initializeWorkspaceServerTransport(candidate, undefined, this.options.client),
                inner
              ),
            { signal, clock: this.clock, timeoutMs: this.options.initializeTimeoutMs ?? 10_000 }
          );
          if (!this.isCurrent(attemptScope, epoch)) {
            candidate.close?.();
            return;
          }
          this.handshake = handshake;
          this.transport.install(candidate);
          if (!this.transport.connected) throw new Error('Host disconnected during initialization');
          this.generation = this.options.nextGeneration?.() ?? this.generation + 1;
          this.lastValidatedAt = this.clock.now();
          this.publish({ kind: 'ready', generation: this.generation });
          this.options.onReady?.(this.attachment);
          this.resolveWaiters();
          return;
        } catch (error) {
          candidate.close?.();
          throw error;
        }
      } catch (error) {
        if (!this.isCurrent(attemptScope, epoch)) return;
        const issue = translateHostPreparationError(this.options.host, phase, error);
        if (isBlocked(error, issue)) {
          if (phase !== 'connecting') this.runtimePolicy = { kind: 'blocked', issue };
          this.publish({
            kind: 'blocked',
            layer: phase === 'connecting' ? 'ssh' : 'runtime',
            issue,
          });
          this.rejectWaiters(issue);
          return;
        }
        if (phase !== 'connecting' && this.options.ssh.connected()) {
          try {
            await runWithTimeout((inner) => this.options.ssh.probe(inner), {
              signal,
              clock: this.clock,
              timeoutMs: this.options.healthTimeoutMs ?? 5_000,
            });
          } catch {
            if (!this.isCurrent(attemptScope, epoch)) return;
            this.resetSsh();
          }
        }
        const delay = this.retrySchedule.delayFor(attempt - 1);
        if (delay === undefined) {
          this.runtimePolicy = { kind: 'paused', reason: 'failed', issue };
          this.publish({ kind: 'paused', reason: 'failed', issue });
          this.rejectWaiters(issue);
          return;
        }
        this.publish({
          kind: 'recovering',
          phase,
          attempt,
          issue,
          nextAttemptAt: this.clock.now() + delay,
        });
        try {
          await this.clock.sleep(delay, { signal, unref: true });
        } catch {
          return;
        }
      }
    }
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
          pending = this.options.runtime.open(target, inner);
          return pending;
        },
        { signal, clock: this.clock, timeoutMs: this.options.openTimeoutMs ?? 10_000 }
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

  private async probeWire(signal: AbortSignal): Promise<void> {
    const physical = this.transport.current;
    const generation = this.transport.generation;
    if (!physical) throw new Error('Host attachment is unavailable');
    // A plain physical transport has no disconnected request queue or replay.
    const connection = connect(physical, {
      clock: this.clock,
      callTimeoutMs: this.options.healthTimeoutMs ?? 5_000,
    });
    try {
      await client(workspaceWireContract, connection).health(undefined, { signal });
      if (generation !== this.transport.generation) throw new Error('Superseded health response');
    } finally {
      connection.dispose();
    }
  }

  private scheduleHealth(): void {
    if (this.timer?.active || !this.enabled || this.systemSuspended || this.scope.disposed) return;
    const interval = this.options.healthIntervalMs ?? 15_000;
    this.timer = this.clock.schedule(
      interval,
      () => {
        this.timer = undefined;
        if (
          this.clock.now() - this.lastValidatedAt >
          interval + (this.options.healthTimeoutMs ?? 5_000)
        ) {
          this.resume();
        } else this.revalidate('timer');
      },
      { unref: true }
    );
  }

  private wait(kind: Waiter['kind'], signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.scope.disposed || !this.enabled)
      return Promise.reject(new Error('Host is disconnected'));
    const state = peek(this.state);
    if (kind === 'runtime' && (this.runtimePaused || !this.runtimeWanted)) {
      return Promise.reject(this.runtimeUnavailable('Host runtime is not being maintained'));
    }
    if (this.usable(kind)) return Promise.resolve();
    if (state.kind === 'blocked' && (kind === 'runtime' || state.layer === 'ssh'))
      return Promise.reject(state.issue);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.waiters.delete(waiter);
        signal?.removeEventListener('abort', abort);
      };
      const waiter: Waiter = {
        kind,
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      const abort = () => waiter.reject(signal?.reason);
      this.waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private usable(kind: Waiter['kind']): boolean {
    return (
      !this.systemSuspended &&
      (kind === 'ssh'
        ? this.options.ssh.connected()
        : peek(this.state).kind === 'ready' && this.transport.connected)
    );
  }
  private resolveWaiters(): void {
    for (const waiter of this.waiters) if (this.usable(waiter.kind)) waiter.resolve();
  }
  private rejectWaiters(error: unknown, kind?: Waiter['kind']): void {
    for (const waiter of this.waiters) if (!kind || waiter.kind === kind) waiter.reject(error);
  }
  private writeIntent(enabled: boolean): Promise<void> {
    const write = this.intentWrites.catch(() => {}).then(() => this.options.intent.write(enabled));
    this.intentWrites = write;
    return write;
  }
  private resetSsh(): void {
    this.resettingSsh = true;
    try {
      this.options.ssh.reset();
    } finally {
      this.resettingSsh = false;
    }
  }
  private cancel(): void {
    this.epoch += 1;
    const active = this.active;
    this.active = undefined;
    void active?.dispose(new Error('Host connection attempt superseded'));
    if (active) this.options.runtime.cancel();
    void this.timer?.dispose();
    this.timer = undefined;
  }
  private isCurrent(attemptScope: Scope, epoch: number): boolean {
    return (
      this.active === attemptScope &&
      this.epoch === epoch &&
      !attemptScope.disposed &&
      !this.scope.disposed
    );
  }
  private publish(state: HostConnectionState): void {
    if (
      this.runtimePolicy.kind === 'paused' &&
      (state.kind === 'idle' || state.kind === 'checking' || state.kind === 'ready')
    ) {
      state = {
        kind: 'paused',
        reason: this.runtimePolicy.reason,
        issue: this.runtimePolicy.issue,
      };
    }
    this.stateCell.set(state);
    this.options.log?.(state, {
      host: this.options.host,
      cause: this.lastCause,
      epoch: this.epoch,
      wireGeneration: this.transport.generation,
      lastValidatedAt: this.lastValidatedAt,
    });
  }
}

function isBlocked(error: unknown, issue: RuntimeResolveError): boolean {
  const visited = new Set<unknown>();
  for (
    let current = error;
    current instanceof Error && !visited.has(current);
    current = current.cause
  ) {
    visited.add(current);
    if (
      current instanceof SshConnectionFailure &&
      ['authentication', 'configuration', 'host-key'].includes(current.kind)
    )
      return true;
  }
  return (
    issue.type !== 'host-unavailable' ||
    !['offline', 'connection-failed', 'runtime-unavailable', 'daemon-start-failed'].includes(
      issue.reason
    )
  );
}

function projectAvailability(state: HostConnectionState): HostAvailabilityState {
  let availability: HostAvailabilityState;
  switch (state.kind) {
    case 'paused':
      availability =
        state.reason === 'operation'
          ? { kind: 'preparing', phase: 'provisioning', attempt: 1 }
          : { kind: 'unavailable', recovery: 'manual', issue: state.issue };
      break;
    case 'ready':
      availability = { kind: 'ready', generation: state.generation };
      break;
    case 'stopped':
      availability = { kind: 'suspended', reason: 'user-disconnected' };
      break;
    case 'idle':
      availability = { kind: 'unavailable', recovery: 'eligible' };
      break;
    case 'blocked':
      availability = { kind: 'unavailable', recovery: 'blocked', issue: state.issue };
      break;
    case 'checking':
      availability = { kind: 'preparing', phase: 'checking', attempt: 1 };
      break;
    default:
      availability =
        state.nextAttemptAt !== undefined
          ? {
              kind: 'unavailable',
              recovery: 'waiting',
              nextAttemptAt: state.nextAttemptAt,
              issue: state.issue,
            }
          : { kind: 'preparing', phase: state.phase, attempt: state.attempt };
  }
  return availability;
}

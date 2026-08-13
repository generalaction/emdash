import { formatHostRef, type HostRef } from '@emdash/core/primitives/host/api';
import {
  runtimeHostUnavailable,
  type RuntimeResolveError,
} from '@emdash/core/primitives/runtime-resolution/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { cell, expose, peek, type Cell, type Readable } from '@emdash/wire/state';
import {
  hostsContract,
  type HostAvailability,
  type HostAvailabilityState,
  type HostPreparingPhase,
  type HostReady,
  type RecoveryCause,
} from '../api';

export type HostReadinessContext = {
  readonly signal: AbortSignal;
  setPhase(phase: HostPreparingPhase): void;
};

export type HostReadinessAdapter = {
  prepare(host: HostRef, context: HostReadinessContext): Promise<Result<void, RuntimeResolveError>>;
};

export type CreateHostAvailabilityOptions = {
  scope: Scope;
  readiness: HostReadinessAdapter;
};

type ActiveRun = {
  identity: {
    superseded?: RuntimeResolveError;
  };
  scope: Scope;
  cause: RecoveryCause;
  promise: Promise<Result<HostReady, RuntimeResolveError>>;
};

export class HostAvailabilityService implements HostAvailability {
  readonly host: LeasedLiveModelProvider<typeof hostsContract.availability>;

  private readonly scope: Scope;
  private readonly states = new Map<string, Cell<HostAvailabilityState>>();
  private readonly runs = new Map<string, ActiveRun>();
  private nextGeneration = 1;

  constructor(private readonly options: CreateHostAvailabilityOptions) {
    this.scope = options.scope.child('host-availability');
    this.host = expose(hostsContract.availability, {
      state: ({ host }) => this.state(host),
    });
    this.scope.add(() => this.host.dispose());
  }

  state(host: HostRef): Readable<HostAvailabilityState> {
    return this.stateCell(host);
  }

  stateFor(host: HostRef): HostAvailabilityState {
    const state = this.states.get(formatHostRef(host));
    return state ? peek(state) : { kind: 'unavailable', recovery: 'eligible' };
  }

  requireReady(host: HostRef): Result<HostReady, RuntimeResolveError> {
    const state = this.stateFor(host);
    if (state.kind === 'ready') return ok({ host, generation: state.generation });
    if (state.kind === 'unavailable' && state.issue) return err(state.issue);

    switch (state.kind) {
      case 'suspended':
      case 'unavailable':
        return err(runtimeHostUnavailable(host, 'offline', 'Host is offline'));
      case 'preparing':
        return err(
          state.phase === 'connecting'
            ? runtimeHostUnavailable(host, 'connection-failed', 'Host connection is not ready')
            : runtimeHostUnavailable(host, 'runtime-unavailable', 'Host runtime is not ready')
        );
    }
  }

  ensureReady(
    host: HostRef,
    cause: RecoveryCause
  ): Promise<Result<HostReady, RuntimeResolveError>> {
    const ready = this.requireReady(host);
    if (ready.success) return Promise.resolve(ready);

    const key = formatHostRef(host);
    const existing = this.runs.get(key);
    if (existing) {
      if (!isExplicit(cause) || isExplicit(existing.cause)) return existing.promise;
      existing.identity.superseded = runtimeHostUnavailable(
        host,
        'runtime-unavailable',
        'Host readiness was superseded'
      );
      this.runs.delete(key);
      void existing.scope.dispose(new Error('Host readiness superseded'));
    }
    if (!isExplicit(cause)) {
      const state = this.stateFor(host);
      if (
        state.kind === 'suspended' ||
        (state.kind === 'unavailable' &&
          (state.recovery === 'manual' || state.recovery === 'blocked'))
      ) {
        return Promise.resolve(ready);
      }
    }

    const runScope = this.scope.child('ready-attempt');
    const identity: ActiveRun['identity'] = {};
    this.setState(host, {
      kind: 'preparing',
      phase: host.type === 'local' ? 'handshaking' : 'connecting',
      attempt: 1,
    });

    const run = runScope.run('prepare', (signal) =>
      this.options.readiness.prepare(host, {
        signal,
        setPhase: (phase) => {
          if (this.runs.get(key)?.identity !== identity) return;
          this.setState(host, { kind: 'preparing', phase, attempt: 1 });
        },
      })
    );
    const promise = run
      .value()
      .then((result) => this.commit(host, identity, result))
      .catch(() => this.commitUnexpectedFailure(host, identity))
      .finally(() => {
        if (this.runs.get(key)?.identity === identity) this.runs.delete(key);
        void runScope.dispose();
      });
    this.runs.set(key, { identity, scope: runScope, cause, promise });
    return promise;
  }

  suspend(host: HostRef): void {
    const key = formatHostRef(host);
    const active = this.runs.get(key);
    if (active) {
      active.identity.superseded = runtimeHostUnavailable(host, 'offline', 'Host is offline');
      this.runs.delete(key);
      void active.scope.dispose(new Error('Host readiness suspended'));
    }
    this.setState(host, { kind: 'suspended', reason: 'user-disconnected' });
  }

  invalidate(host: HostRef, issue?: RuntimeResolveError): void {
    if (this.stateFor(host).kind === 'suspended') return;
    const key = formatHostRef(host);
    const active = this.runs.get(key);
    if (active) {
      active.identity.superseded =
        issue ?? runtimeHostUnavailable(host, 'offline', 'Host is offline');
      this.runs.delete(key);
      void active.scope.dispose(new Error('Host readiness invalidated'));
    }
    this.setState(host, {
      kind: 'unavailable',
      ...(issue ? { issue } : {}),
      recovery: issue ? recoveryFor(issue) : 'eligible',
    });
  }

  /** Temporary alias for pre-availability gateway callers. */
  markUnavailable(host: HostRef, issue?: RuntimeResolveError): void {
    this.invalidate(host, issue);
  }

  private commit(
    host: HostRef,
    identity: ActiveRun['identity'],
    result: Result<void, RuntimeResolveError>
  ): Result<HostReady, RuntimeResolveError> {
    if (this.runs.get(formatHostRef(host))?.identity !== identity) {
      return err(
        identity.superseded ??
          runtimeHostUnavailable(host, 'runtime-unavailable', 'Host readiness was superseded')
      );
    }
    if (!result.success) {
      this.setState(host, {
        kind: 'unavailable',
        issue: result.error,
        recovery: recoveryFor(result.error),
      });
      return result;
    }

    const generation = this.nextGeneration++;
    this.setState(host, { kind: 'ready', generation });
    return ok({ host, generation });
  }

  private commitUnexpectedFailure(
    host: HostRef,
    identity: ActiveRun['identity']
  ): Result<HostReady, RuntimeResolveError> {
    if (this.runs.get(formatHostRef(host))?.identity !== identity) {
      return err(
        identity.superseded ??
          runtimeHostUnavailable(host, 'runtime-unavailable', 'Host readiness was superseded')
      );
    }
    const error = runtimeHostUnavailable(
      host,
      'runtime-unavailable',
      'Host runtime preparation failed'
    );
    this.setState(host, { kind: 'unavailable', issue: error, recovery: recoveryFor(error) });
    return err(error);
  }

  private stateCell(host: HostRef): Cell<HostAvailabilityState> {
    const key = formatHostRef(host);
    let state = this.states.get(key);
    if (!state) {
      state = cell<HostAvailabilityState>({ kind: 'unavailable', recovery: 'eligible' });
      this.states.set(key, state);
    }
    return state;
  }

  private setState(host: HostRef, state: HostAvailabilityState): void {
    this.stateCell(host).set(state);
  }
}

export function createHostAvailability(
  options: CreateHostAvailabilityOptions
): HostAvailabilityService {
  return new HostAvailabilityService(options);
}

function isExplicit(cause: RecoveryCause): boolean {
  return cause === 'connect' || cause === 'retry';
}

function recoveryFor(
  error: RuntimeResolveError
): Extract<HostAvailabilityState, { kind: 'unavailable' }>['recovery'] {
  if (error.type !== 'host-unavailable') return 'blocked';
  switch (error.reason) {
    case 'offline':
    case 'connection-failed':
    case 'daemon-start-failed':
    case 'runtime-unavailable':
      return 'eligible';
    case 'artifact-download-failed':
    case 'install-failed':
      return 'manual';
    case 'unsupported-platform':
    case 'protocol-upgrade-client':
    case 'protocol-upgrade-server':
      return 'blocked';
  }
}

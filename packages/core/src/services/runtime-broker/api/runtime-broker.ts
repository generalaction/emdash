import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import { createResourceCache, type ResourceCache, type Scope } from '@emdash/shared/concurrency';
import type { Contract, ContractClient } from '@emdash/wire';
import { hostRefKey, type HostRef } from '../../../primitives/host/api';
import type { hostRuntimesContract } from './contract';
import type { RuntimeResolveError } from './errors';

type ContractDefinitionsOf<TContract> =
  TContract extends Contract<infer Definitions> ? Definitions : never;

export type HostRuntimesClient = ContractClient<ContractDefinitionsOf<typeof hostRuntimesContract>>;

export type RuntimeSession = Result<HostRuntimesClient, RuntimeResolveError>;

export type RuntimeSessionResolver = (
  host: HostRef,
  scope: Scope
) => RuntimeSession | Promise<RuntimeSession>;

export type RuntimeBrokerOptions = Readonly<{
  resolve: RuntimeSessionResolver;
  scope?: Scope;
  idleTtlMs?: number;
}>;

export class RuntimeBroker {
  private readonly sessions: ResourceCache<HostRef, HostRuntimesClient>;

  constructor(options: RuntimeBrokerOptions) {
    this.sessions = createResourceCache({
      key: hostRefKey,
      scope: options.scope,
      label: 'runtime-broker',
      idleTtlMs: options.idleTtlMs,
      create: async (host, scope) => {
        const session = await options.resolve(host, scope);
        // ResourceCache evicts rejected creations. Convert only typed resolution failures
        // internally, then map them back to Result values at the lease boundary.
        if (!session.success) throw new RuntimeSessionResolutionFailure(session.error);
        return session.data;
      },
    });
  }

  session(host: HostRef): PendingLease<RuntimeSession> {
    const lease = this.sessions.acquire(host);
    return {
      ready: async () => {
        try {
          return ok(await lease.ready());
        } catch (error) {
          if (error instanceof RuntimeSessionResolutionFailure) return err(error.error);
          throw error;
        }
      },
      release: lease.release,
    };
  }

  peek(host: HostRef): RuntimeSession | undefined {
    const client = this.sessions.peek(host);
    return client ? ok(client) : undefined;
  }

  // TODO(remote SSH): Invalidate remote sessions when their SSH connection state changes.
  invalidate(host: HostRef): Promise<void> {
    return this.sessions.invalidate(host);
  }

  dispose(): Promise<void> {
    return this.sessions.dispose();
  }
}

class RuntimeSessionResolutionFailure {
  constructor(readonly error: RuntimeResolveError) {}
}

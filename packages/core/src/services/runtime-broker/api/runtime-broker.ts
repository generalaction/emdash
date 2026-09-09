import { err, ok, type Result } from '@emdash/shared';
import type { Contract, ContractClient } from '@emdash/wire/rpc';
import { formatHostRef, type HostRef } from '../../../primitives/host/api';
import { runtimeHostIdentityLost } from '../../../primitives/runtime-resolution/api';
import type { hostRuntimesContract } from './contract';
import type { RuntimeResolveError } from './errors';
import {
  createRuntimeClientBinding,
  type RuntimeClientBinding,
  type RuntimeClientSource,
} from './runtime-client-binding';

type ContractDefinitionsOf<TContract> =
  TContract extends Contract<infer Definitions> ? Definitions : never;

export type HostRuntimesClient = ContractClient<ContractDefinitionsOf<typeof hostRuntimesContract>>;

export type RuntimeSession = Result<HostRuntimesClient, RuntimeResolveError>;

export type RuntimeSessionResolution = Result<RuntimeClientSource, RuntimeResolveError>;

export type RuntimeSessionResolver = (
  host: HostRef
) => RuntimeSessionResolution | Promise<RuntimeSessionResolution>;

export type RuntimeBrokerOptions = Readonly<{
  resolve: RuntimeSessionResolver;
  invalidate?: (host: HostRef) => void | Promise<void>;
}>;

export class RuntimeBroker {
  private readonly bindings = new Map<string, RuntimeClientBinding>();
  private readonly rebindEpochs = new Map<string, number>();
  private readonly identityEpochs = new Map<string, number>();

  constructor(private readonly options: RuntimeBrokerOptions) {}

  async client(host: HostRef): Promise<RuntimeSession> {
    const key = formatHostRef(host);
    const rebindEpoch = this.rebindEpochs.get(key) ?? 0;
    const identityEpoch = this.identityEpochs.get(key) ?? 0;
    const resolved = await this.options.resolve(host);
    if ((this.identityEpochs.get(key) ?? 0) !== identityEpoch) {
      return err(runtimeHostIdentityLost(host, 'Host identity changed during runtime resolution'));
    }
    if (!resolved.success) return resolved;
    if ((this.rebindEpochs.get(key) ?? 0) !== rebindEpoch) {
      const rebound = this.bindings.get(key);
      if (rebound) return ok(rebound.client);
      return err(runtimeHostIdentityLost(host, 'Host identity changed during runtime resolution'));
    }
    return ok(this.bind(host, resolved.data));
  }

  rebind(host: HostRef, source: RuntimeClientSource): HostRuntimesClient {
    const key = formatHostRef(host);
    this.rebindEpochs.set(key, (this.rebindEpochs.get(key) ?? 0) + 1);
    return this.bind(host, source);
  }

  private bind(host: HostRef, source: RuntimeClientSource): HostRuntimesClient {
    const key = formatHostRef(host);
    let binding = this.bindings.get(key);
    if (!binding || !binding.rebind(source)) {
      binding?.dispose();
      binding = createRuntimeClientBinding(source);
      this.bindings.set(key, binding);
    }
    return binding.client;
  }

  async invalidate(host: HostRef): Promise<void> {
    await this.options.invalidate?.(host);
  }

  /** Final identity invalidation, unlike ordinary physical transport recovery. */
  forget(host: HostRef): void {
    const key = formatHostRef(host);
    this.identityEpochs.set(key, (this.identityEpochs.get(key) ?? 0) + 1);
    this.rebindEpochs.set(key, (this.rebindEpochs.get(key) ?? 0) + 1);
    this.bindings.get(key)?.dispose();
    this.bindings.delete(key);
  }

  dispose(): void {
    for (const binding of this.bindings.values()) binding.dispose();
    this.bindings.clear();
    this.rebindEpochs.clear();
    this.identityEpochs.clear();
  }
}

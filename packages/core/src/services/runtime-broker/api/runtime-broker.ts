import type { Result } from '@emdash/shared';
import type { Contract, ContractClient } from '@emdash/wire';
import type { HostRef } from '../../../primitives/host/api';
import type { hostRuntimesContract } from './contract';
import type { RuntimeResolveError } from './errors';

type ContractDefinitionsOf<TContract> =
  TContract extends Contract<infer Definitions> ? Definitions : never;

export type HostRuntimesClient = ContractClient<ContractDefinitionsOf<typeof hostRuntimesContract>>;

export type RuntimeSession = Result<HostRuntimesClient, RuntimeResolveError>;

export type RuntimeSessionResolver = (host: HostRef) => RuntimeSession | Promise<RuntimeSession>;

export type RuntimeBrokerOptions = Readonly<{
  resolve: RuntimeSessionResolver;
  invalidate?: (host: HostRef) => void | Promise<void>;
}>;

export class RuntimeBroker {
  constructor(private readonly options: RuntimeBrokerOptions) {}

  async client(host: HostRef): Promise<RuntimeSession> {
    return await this.options.resolve(host);
  }

  async invalidate(host: HostRef): Promise<void> {
    await this.options.invalidate?.(host);
  }
}

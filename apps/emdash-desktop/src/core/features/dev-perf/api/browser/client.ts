import type { ContractClient } from '@emdash/wire/rpc';
import type { devPerfContract } from '../contract';

export type DevPerfRpcClient = ContractClient<typeof devPerfContract>;

let provider: (() => Promise<DevPerfRpcClient>) | null = null;

/** Host bootstrap injects the wire-backed client (core cannot import host). */
export function configureDevPerfClient(getClient: () => Promise<DevPerfRpcClient>): void {
  provider = getClient;
}

export function getDevPerfClient(): Promise<DevPerfRpcClient> {
  if (!provider) throw new Error('dev-perf client has not been configured');
  return provider();
}

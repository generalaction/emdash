import type { ContractClient } from '@agent/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { hostsContract, hostsDomain } from './contract';

export type HostsClient = ContractClient<typeof hostsContract>;

export function getHostsClient(): Promise<HostsClient> {
  return domainClient<HostsClient>(hostsDomain, hostsContract);
}

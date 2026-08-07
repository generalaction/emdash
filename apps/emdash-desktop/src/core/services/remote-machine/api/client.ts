import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { remoteMachineContract, remoteMachineDomain } from './contract';

export type RemoteMachineClient = ContractClient<typeof remoteMachineContract>;

export function getRemoteMachineClient(): Promise<RemoteMachineClient> {
  return domainClient<RemoteMachineClient>(remoteMachineDomain, remoteMachineContract);
}

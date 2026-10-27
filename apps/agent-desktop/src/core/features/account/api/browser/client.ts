import type { ContractClient } from '@agent/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { accountContract, accountDomain } from '../contract';

export type AccountClient = ContractClient<typeof accountContract>;

export function getAccountClient(): Promise<AccountClient> {
  return domainClient<AccountClient>(accountDomain, accountContract);
}

import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { usageContract, usageDomain } from '../contract';

export function getUsageClient(): Promise<ContractClient<typeof usageContract>> {
  return domainClient(usageDomain, usageContract);
}

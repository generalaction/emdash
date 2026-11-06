import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { waitlistContract, waitlistDomain } from '../contract';

export type WaitlistClient = ContractClient<typeof waitlistContract>;

export function getWaitlistClient(): Promise<WaitlistClient> {
  return domainClient<WaitlistClient>(waitlistDomain, waitlistContract);
}

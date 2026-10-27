import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { automationsContract, automationsDomain } from '../contract';

export type AutomationsClient = ContractClient<typeof automationsContract>;

export function getAutomationsClient(): Promise<AutomationsClient> {
  return domainClient<AutomationsClient>(automationsDomain, automationsContract);
}

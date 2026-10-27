import type { ContractClient } from '@agent/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { legacyPortContract, legacyPortDomain } from '../contract';

export type LegacyPortClient = ContractClient<typeof legacyPortContract>;

export function getLegacyPortClient(): Promise<LegacyPortClient> {
  return domainClient<LegacyPortClient>(legacyPortDomain, legacyPortContract);
}

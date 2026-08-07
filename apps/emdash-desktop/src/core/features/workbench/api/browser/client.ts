import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { desktopHostContract, desktopHostDomain } from '../host-contract';

export type DesktopHostClient = ContractClient<typeof desktopHostContract>;

export function getDesktopHostClient(): Promise<DesktopHostClient> {
  return domainClient<DesktopHostClient>(desktopHostDomain, desktopHostContract);
}

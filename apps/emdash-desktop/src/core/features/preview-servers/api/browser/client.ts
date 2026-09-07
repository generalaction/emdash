import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { previewServersContract, previewServersDomain } from '../contract';

export type PreviewServersClient = ContractClient<typeof previewServersContract>;

export function getPreviewServersClient(): Promise<PreviewServersClient> {
  return domainClient<PreviewServersClient>(previewServersDomain, previewServersContract);
}

import type { ContractClient } from '@agent/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { promptLibraryContract, promptLibraryDomain } from '../contract';

export type PromptLibraryClient = ContractClient<typeof promptLibraryContract>;

export function getPromptLibraryClient(): Promise<PromptLibraryClient> {
  return domainClient<PromptLibraryClient>(promptLibraryDomain, promptLibraryContract);
}

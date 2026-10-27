import type { ContractClient } from '@agent/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { issuesContract, issuesDomain } from '../contract';

export type IssuesClient = ContractClient<typeof issuesContract>;

export function getIssuesClient(): Promise<IssuesClient> {
  return domainClient<IssuesClient>(issuesDomain, issuesContract);
}

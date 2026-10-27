import type { ContractClient } from '@agent/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { pullRequestsContract, pullRequestsDomain, type PullRequestsContract } from './contract';

export type PullRequestsRuntimeClient = ContractClient<PullRequestsContract>;

export function getPullRequestsRuntimeClient(): Promise<PullRequestsRuntimeClient> {
  return domainClient<PullRequestsRuntimeClient>(pullRequestsDomain, pullRequestsContract);
}

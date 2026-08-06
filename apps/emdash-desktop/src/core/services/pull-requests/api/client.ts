import type { ContractClient } from '@emdash/wire/rpc';
import type { PullRequestsContract } from './contract';

export type PullRequestsRuntimeClient = ContractClient<PullRequestsContract>;

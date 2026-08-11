import type {
  ConnectionStatus,
  IssueContextOpts,
  IssueContextResult,
  IssueListResult,
  IssueProviderCapabilities,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@core/primitives/issue-providers/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

export type {
  IssueContextOpts,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@core/primitives/issue-providers/api';

export interface IssueProvider {
  readonly type: LinkedIssue['provider'];
  readonly capabilities: IssueProviderCapabilities;

  isConfigured?(): Promise<boolean>;
  checkConnection(): Promise<ConnectionStatus>;
  listIssues(opts: IssueQueryOpts): Promise<IssueListResult>;
  searchIssues(opts: IssueSearchOpts): Promise<IssueListResult>;
  getIssueContext?(opts: IssueContextOpts): Promise<IssueContextResult>;
}

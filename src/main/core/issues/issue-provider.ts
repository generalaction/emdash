import type { LinkedIssue } from '@shared/core/linked-issue';
import type {
  ConnectionStatus,
  IssueContextResult,
  IssueListResult,
  IssueProviderCapabilities,
} from '@shared/issue-providers';

export type IssueQueryOpts = {
  limit?: number;
  projectId?: string;
  projectPath?: string;
  remote?: string;
  repositoryUrl?: string;
};

export type IssueSearchOpts = IssueQueryOpts & {
  searchTerm: string;
};

export type IssueContextOpts = IssueQueryOpts & {
  identifier: string;
};

export interface IssueProvider {
  readonly type: LinkedIssue['provider'];
  readonly capabilities: IssueProviderCapabilities;

  checkConnection(): Promise<ConnectionStatus>;
  listIssues(opts: IssueQueryOpts): Promise<IssueListResult>;
  searchIssues(opts: IssueSearchOpts): Promise<IssueListResult>;
  getIssueContext?(opts: IssueContextOpts): Promise<IssueContextResult>;
}

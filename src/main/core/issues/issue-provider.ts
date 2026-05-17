import type {
  ConnectionStatus,
  IssueListResult,
  IssueProviderCapabilities,
} from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';

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

export interface IssueProvider {
  readonly type: Issue['provider'];
  readonly capabilities: IssueProviderCapabilities;

  checkConnection(): Promise<ConnectionStatus>;
  listIssues(opts: IssueQueryOpts): Promise<IssueListResult>;
  searchIssues(opts: IssueSearchOpts): Promise<IssueListResult>;
}

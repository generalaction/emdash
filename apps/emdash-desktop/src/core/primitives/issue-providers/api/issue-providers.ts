import type { IssueError } from '@emdash/plugins/issues';
import type { Result } from '@emdash/shared';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

export type IssueProviderType = LinkedIssue['provider'];

export type IssueProviderCapabilities = {
  requiresRepositoryUrl: boolean;
  supportsIssueContext: boolean;
};

export type ConnectionStatus = {
  connected: boolean;
  displayName?: string;
  displayDetail?: string;
  error?: string;
  capabilities: IssueProviderCapabilities;
};

export type ConnectionStatusMap = Record<IssueProviderType, ConnectionStatus>;

export type IssueAccountError =
  | { type: 'no_account_selected'; message: string }
  | { type: 'account_disabled'; message: string }
  | { type: 'account_not_found'; host?: string; accountId?: string; message: string }
  | {
      type: 'account_host_mismatch';
      host: string;
      accountId: string;
      accountHost: string;
      message: string;
    }
  | { type: 'token_missing'; host: string; accountId: string; message: string }
  | { type: 'auth_required'; host?: string; message: string };

export type IssueListError = IssueError | IssueAccountError;

export type IssueListResult = Result<LinkedIssue[], IssueListError>;

export type IssueContextResult = Result<LinkedIssue, IssueListError>;

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

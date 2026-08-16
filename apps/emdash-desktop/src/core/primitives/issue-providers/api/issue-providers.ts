import type { IssueError } from '@emdash/plugins/issues';
import type { Result } from '@emdash/shared';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type { Provenance } from '@core/primitives/project-settings/api';

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

/**
 * The project's GitHub account resolution produced no usable account. Carries
 * the blessed resolver's provenance (spec: github-git-settings §7) so
 * surfaces render the reporting matrix instead of a re-encoded error
 * vocabulary: `set` is the explicit "GitHub disabled" intent, `inferred`
 * means inference found nothing (only sent when no accounts are connected),
 * and `unresolvable` is a dangling or host-mismatched pin (fail closed).
 */
export type IssueAccountUnavailableError = {
  type: 'account_unavailable';
  provenance: Provenance;
  /** Whether any GitHub accounts are connected at all. */
  accountsConnected: boolean;
  message: string;
};

export type IssueAccountError =
  | IssueAccountUnavailableError
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

export type IssueProjectUnavailableError = {
  type: 'project_unavailable';
  projectId: string;
  reason: string;
  message: string;
};

export type IssueListError = IssueError | IssueAccountError | IssueProjectUnavailableError;

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

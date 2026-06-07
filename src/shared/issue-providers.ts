import type { LinkedIssue } from './linked-issue';

export type IssueProviderType = LinkedIssue['provider'];

export type IssueProviderCapabilities = {
  requiresProjectPath: boolean;
  requiresRepositoryUrl: boolean;
  supportsIssueContext: boolean;
};

export const ISSUE_PROVIDER_CAPABILITIES: Record<IssueProviderType, IssueProviderCapabilities> = {
  linear: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
    supportsIssueContext: true,
  },
  github: {
    requiresProjectPath: false,
    requiresRepositoryUrl: true,
    supportsIssueContext: false,
  },
  jira: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
    supportsIssueContext: false,
  },
  gitlab: {
    requiresProjectPath: true,
    requiresRepositoryUrl: false,
    supportsIssueContext: false,
  },
  forgejo: {
    requiresProjectPath: true,
    requiresRepositoryUrl: false,
    supportsIssueContext: false,
  },
  featurebase: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
    supportsIssueContext: false,
  },
  plain: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
    supportsIssueContext: true,
  },
  asana: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
    supportsIssueContext: false,
  },
  monday: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
    supportsIssueContext: true,
  },
  trello: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
    supportsIssueContext: true,
  },
};

export type ConnectionStatus = {
  connected: boolean;
  displayName?: string;
  error?: string;
  capabilities: IssueProviderCapabilities;
};

export type ConnectionStatusMap = Record<IssueProviderType, ConnectionStatus>;

export type IssueListError =
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
  | { type: 'auth_required'; host: string; message: string }
  | { type: 'not_found_or_no_access'; host: string; message: string }
  | { type: 'sso_required'; host: string; message: string; ssoUrl?: string }
  | { type: 'rate_limited'; host: string; message: string; resetAt?: string }
  | { type: 'forbidden'; host: string; message: string }
  | { type: 'host_unreachable'; host: string; message: string }
  | { type: 'unsupported_host'; host: string; message: string }
  | { type: 'generic'; message: string };

export type IssueListResult =
  | { success: true; issues: LinkedIssue[] }
  | {
      success: false;
      error: string;
      errorType?: IssueListError['type'];
      host?: string;
      accountId?: string;
      accountHost?: string;
      resetAt?: string;
      ssoUrl?: string;
    };

export type IssueContextResult =
  | { success: true; issue: LinkedIssue }
  | { success: false; error: string };

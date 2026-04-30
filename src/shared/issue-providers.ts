import type { Issue } from './tasks';

export type IssueProviderType = Issue['provider'];

export type IssueProviderCapabilities = {
  requiresProjectPath: boolean;
  requiresRepositoryUrl: boolean;
};

export const ISSUE_PROVIDER_CAPABILITIES: Record<IssueProviderType, IssueProviderCapabilities> = {
  linear: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  github: {
    requiresProjectPath: false,
    requiresRepositoryUrl: true,
  },
  jira: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  gitlab: {
    requiresProjectPath: true,
    requiresRepositoryUrl: false,
  },
  forgejo: {
    requiresProjectPath: true,
    requiresRepositoryUrl: false,
  },
  plain: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
};

export type ConnectionStatus = {
  connected: boolean;
  displayName?: string;
  error?: string;
  capabilities: IssueProviderCapabilities;
};

export type ConnectionStatusMap = Record<IssueProviderType, ConnectionStatus>;

export type IssueListResult =
  | { success: true; issues: Issue[] }
  | { success: false; error: string };

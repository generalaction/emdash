import type { Issue } from './tasks';

export type IssueProviderType = Issue['provider'];

export type IssueProviderCapabilities = {
  requiresProjectPath: boolean;
  requiresNameWithOwner: boolean;
};

export const ISSUE_PROVIDER_CAPABILITIES: Record<IssueProviderType, IssueProviderCapabilities> = {
  linear: {
    requiresProjectPath: false,
    requiresNameWithOwner: false,
  },
  github: {
    requiresProjectPath: false,
    requiresNameWithOwner: true,
  },
  jira: {
    requiresProjectPath: false,
    requiresNameWithOwner: false,
  },
  gitlab: {
    requiresProjectPath: true,
    requiresNameWithOwner: false,
  },
  forgejo: {
    requiresProjectPath: true,
    requiresNameWithOwner: false,
  },
  plain: {
    requiresProjectPath: false,
    requiresNameWithOwner: false,
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

import type { ProviderId } from '@shared/providers/registry';
import { type LinearIssueSummary } from './linear';
import { type GitHubIssueSummary } from './github';
import { type JiraIssueSummary } from './jira';

/** Per-provider run configuration for workspace creation */
export interface ProviderRun {
  provider: ProviderId;
  runs: number;
}

export interface WorkspaceMetadata {
  linearIssue?: LinearIssueSummary | null;
  githubIssue?: GitHubIssueSummary | null;
  jiraIssue?: JiraIssueSummary | null;
  initialPrompt?: string | null;
  autoApprove?: boolean | null;
  /** Set to true after the initial injection (prompt/issue) has been sent to the agent */
  initialInjectionSent?: boolean | null;
  // When present, this workspace is a multi-agent workspace orchestrating multiple worktrees
  multiAgent?: {
    enabled: boolean;
    // Max panes allowed when the workspace was created (UI hint)
    maxProviders?: number;
    // Per-provider run configuration
    providerRuns?: ProviderRun[];
    // Legacy: Number of runs per provider (deprecated, kept for backwards compatibility)
    runsPerProvider?: number;
    // Legacy: Selected providers (deprecated, kept for backwards compatibility)
    providers: ProviderId[];
    variants: Array<{
      id: string;
      provider: ProviderId;
      name: string; // worktree display name, e.g. workspaceName-providerSlug
      branch: string;
      path: string; // filesystem path of the worktree
      worktreeId: string; // WorktreeService id (stable hash of path)
    }>;
    selectedProvider?: ProviderId | null;
  } | null;
}

export interface Workspace {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  metadata?: WorkspaceMetadata | null;
}

export interface Message {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: Date;
  attachments?: string[];
}

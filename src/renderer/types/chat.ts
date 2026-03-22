import type { ProviderId } from '@shared/providers/registry';
import { type LinearIssueSummary } from './linear';
import { type GitHubIssueSummary } from './github';
import { type JiraIssueSummary } from './jira';
import { type PlainThreadSummary } from './plain';
import { type GitLabIssueSummary } from './gitlab';
import { type ForgejoIssueSummary } from './forgejo';

/** Per-agent run configuration for task creation */
export interface AgentRun {
  agent: ProviderId;
  runs: number;
}

export interface GitHubIssueLink {
  number: number;
  taskId: string;
  taskName: string;
}

export interface TaskMetadata {
  linearIssue?: LinearIssueSummary | null;
  githubIssue?: GitHubIssueSummary | null;
  jiraIssue?: JiraIssueSummary | null;
  plainThread?: PlainThreadSummary | null;
  gitlabIssue?: GitLabIssueSummary | null;
  forgejoIssue?: ForgejoIssueSummary | null;
  initialPrompt?: string | null;
  autoApprove?: boolean | null;
  /** True when the task name was auto-generated (not manually typed by the user) */
  nameGenerated?: boolean | null;
  /** Set to true after the initial injection (prompt/issue) has been sent to the agent */
  initialInjectionSent?: boolean | null;
  // When present, the task was created with a remote workspace provider
  workspace?: {
    provisionCommand: string;
    terminateCommand: string;
  } | null;
  /** Whether this task is pinned to the top of the sidebar */
  isPinned?: boolean | null;
  /** The automation that created this task (if any) */
  automationId?: string | null;
  /** PR number when this task is a PR review task */
  prNumber?: number | null;
  /** PR title when this task is a PR review task */
  prTitle?: string | null;
  // When present, this task is a multi-agent task orchestrating multiple worktrees
  multiAgent?: {
    enabled: boolean;
    // Max panes allowed when the task was created (UI hint)
    maxAgents?: number;
    // Per-agent run configuration
    agentRuns?: AgentRun[];
    // Legacy list of agent ids before agentRuns existed (for backward compatibility)
    agents?: ProviderId[];
    variants: Array<{
      id: string;
      agent: ProviderId;
      name: string; // worktree display name, e.g. taskName-agentSlug
      branch: string;
      path: string; // filesystem path of the worktree
      worktreeId: string; // WorktreeService id (stable hash of path)
    }>;
    selectedAgent?: ProviderId | null;
  } | null;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  metadata?: TaskMetadata | null;
  useWorktree?: boolean;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  agentId?: string;
}

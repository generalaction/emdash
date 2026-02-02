import type { ProviderId } from '@shared/providers/registry';
import { type LinearIssueSummary } from './linear';
import { type GitHubIssueSummary } from './github';
import { type JiraIssueSummary } from './jira';

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
  initialPrompt?: string | null;
  autoApprove?: boolean | null;
  /** Set to true after the initial injection (prompt/issue) has been sent to the agent */
  initialInjectionSent?: boolean | null;
  // When present, this task is a multi-agent task orchestrating multiple worktrees
  multiAgent?: {
    enabled: boolean;
    // Max panes allowed when the task was created (UI hint)
    maxAgents?: number;
    // Per-agent run configuration
    agentRuns?: AgentRun[];
    // Legacy list of agent ids before agentRuns existed (for backward compatibility)
    agents?: ProviderId[];
    // Per-task UI preference for split view (all panes visible)
    splitViewEnabled?: boolean;
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
  createdAt?: string;
  updatedAt?: string;
  agentId?: string;
}

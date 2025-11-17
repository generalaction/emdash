import { type LinearIssueSummary } from './linear';
import { type GitHubIssueSummary } from './github';
import { type JiraIssueSummary } from './jira';

export interface WorkspaceMetadata {
  linearIssue?: LinearIssueSummary | null;
  githubIssue?: GitHubIssueSummary | null;
  jiraIssue?: JiraIssueSummary | null;
  initialPrompt?: string | null;
  // When present, this workspace is a multi-agent workspace orchestrating multiple worktrees
  multiAgent?: {
    enabled: boolean;
    // Max panes allowed when the workspace was created (UI hint)
    maxProviders?: number;
    // Selected providers to run in parallel (ids match Provider type)
    providers: Array<
      | 'codex'
      | 'claude'
      | 'qwen'
      | 'droid'
      | 'gemini'
      | 'cursor'
      | 'copilot'
      | 'amp'
      | 'opencode'
      | 'charm'
      | 'auggie'
      | 'goose'
      | 'kimi'
      | 'kiro'
    >;
    variants: Array<{
      id: string; // stable variant id within this workspace
      provider:
        | 'codex'
        | 'claude'
        | 'qwen'
        | 'droid'
        | 'gemini'
        | 'cursor'
        | 'copilot'
        | 'amp'
        | 'opencode'
        | 'charm'
        | 'auggie'
        | 'goose'
        | 'kimi'
        | 'kiro';
      name: string; // worktree display name, e.g. workspaceName-providerSlug
      branch: string;
      path: string; // filesystem path of the worktree
      worktreeId: string; // WorktreeService id (stable hash of path)
    }>;
    selectedProvider?:
      | 'codex'
      | 'claude'
      | 'qwen'
      | 'droid'
      | 'gemini'
      | 'cursor'
      | 'copilot'
      | 'amp'
      | 'opencode'
      | 'charm'
      | 'auggie'
      | 'goose'
      | 'kimi'
      | 'kiro'
      | null;
  } | null;
}

export interface Workspace {
  id: string;
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

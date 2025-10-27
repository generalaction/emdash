import { type LinearIssueSummary } from './linear';
import { type GitHubIssueSummary } from './github';
import { type JiraIssueSummary } from './jira';

export interface WorkspaceMetadata {
  linearIssue?: LinearIssueSummary | null;
  githubIssue?: GitHubIssueSummary | null;
  jiraIssue?: JiraIssueSummary | null;
  initialPrompt?: string | null;
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

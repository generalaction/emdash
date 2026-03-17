export interface GitHubIssueSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: string | null;
  updatedAt: string | null;
  comments: number;
  user: { login: string; avatarUrl: string } | null;
  assignees: Array<{ login: string; avatarUrl: string }>;
  labels: Array<{ name: string; color: string }>;
  body?: string | null;
}

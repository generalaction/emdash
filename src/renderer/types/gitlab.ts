export interface GitLabIssueSummary {
  id: number;
  iid: number; // project-scoped issue number
  title: string;
  description?: string | null;
  web_url?: string | null;
  state?: string | null; // "opened" | "closed"
  project?: { name: string } | null;
  assignee?: { name: string; username: string } | null;
  labels?: string[] | null;
  updated_at?: string | null;
}

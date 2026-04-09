export interface GitLabIssueSummary {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  webUrl: string | null;
  state: string | null;
  project: { name: string } | null;
  assignee: { name: string; username: string } | null;
  labels: string[];
  updatedAt: string | null;
}

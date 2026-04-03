export interface ForgejoIssueSummary {
  id: number;
  number: number;
  title: string;
  description: string | null;
  htmlUrl: string | null;
  state: string | null;
  repo: string | null;
  assignee: { name: string; username: string } | null;
  labels: string[];
  updatedAt: string | null;
}
